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
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Image, PanResponder, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  adminAssignRoster, adminLeagueJoiners, adminLeagueMembers, commishBulkCoin,
  commishClaimRoster, commishClearCoin, commishGrantWeeklyBudget, commishOverview,
  commishSeedCoin, commishSetManager, commishSetWeeklyBudget, friendlyError,
  leagueInvite, nativeTeamState,
  setTeamAvatar, setTeamController, setTeamName, teamManagers,
  type AdminMember, type LeagueJoiner, type NativeTeamState, type TeamManagerRow,
  leagueLastSeen, seenAgoLabel, leagueLiveBuffs, setLeagueLiveBuffs, type LeagueSeenRow,
  leagueGameMode, setLeagueGameMode, setLeagueClassicScoring, setLeagueClassicSlots, setLeagueRosterShape, setLeaguePoolFilter,
  leagueKdst, setKdstMode, type LeagueKdst, type KdstMode,
  leagueFaabWallets, commishGrantFaab, rosterRules, type FaabWallets, type WaiverMode,
  keeperState, rolloverLeague, leaguePool, type KeeperState,
  pickAssets, type PickAssetRow,
  setLeagueContinuity, type LeagueContinuity,
  setLeagueName, setLeagueAvatar, myEnrollments,
} from '@drip/core/data/liveApi';
import { classicSlots, CLASSIC_SCORING_SECTIONS, CLASSIC_SCORING_FIELDS, DEFAULT_CLASSIC_SCORING, type SlotSpec } from '@drip/core/engine/classic';
import { NFL_CODES } from '@drip/core/data/kdst';

// The builder's position chips (0163) — combos are made by lighting several.
const BUILDER_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB'];
import { useTheme, MONO, fs } from '../theme.native';
import { tap, commit, warn } from '../ui/feedback';
import { Card, Chip, Display, LinkButton, Mono, Notice, PrimaryButton } from '../ui/prims';
import { Overlay } from '../ui/Overlay';
import { AvatarGrid } from '../ui/AvatarGrid';
import { CommishSettings } from '../ui/CommishSettings';
import { CommishPlayers } from '../ui/LeagueExtras';
import { CommishToolsCard } from '../ui/CommishKit';

// The app's commissioner map — the same grouping as the web side rail, so a
// commissioner who learns one host already knows the other. `nativeOnly`
// hides what a Sleeper-backed league manages on its own platform.
const NAV_GROUPS: { title: string; items: { id: string; label: string; nativeOnly?: boolean }[] }[] = [
  // MODE & SCORING was ONE mega-scroll (mode toggle + roster builder + the
  // ~36-knob catalog stacked); the scoring knobs lived two screens below the
  // fold. Split three ways (v0.259.0) to match the web rail exactly.
  { title: 'SET UP', items: [
    // 0187: the league's own identity — the name had NO setter at all before
    // this, so a typo at creation was permanent for every member.
    { id: 'identity', label: '🏷 NAME & CREST' },
    { id: 'mode', label: '🎮 MODE' },
    { id: 'lineup', label: '🧩 ROSTER' },
    { id: 'scoring', label: '⚖ SCORING' },
    // the old ⚑ SETTINGS overlay, folded into the map (v0.264.0) — each slice
    // is its own destination, mirroring the web console's sections
    { id: 'waivers', label: '⇄ WAIVERS & TRADES', nativeOnly: true },
  ] },
  { title: 'RUN THE SEASON', items: [
    { id: 'seats', label: '👥 SEATS' },
    { id: 'players', label: '🧑 PLAYERS', nativeOnly: true },
    { id: 'playoffs', label: '🏆 PLAYOFFS', nativeOnly: true },
    { id: 'dynasty', label: '🔁 NEXT SEASON', nativeOnly: true },
  ] },
  { title: 'ENGAGE', items: [
    { id: 'kit', label: '⚑ KIT' },
    { id: 'activity', label: '👁 ACTIVITY' },
    { id: 'buffs', label: '◈ POWER-UPS' },
    { id: 'board', label: '📣 LEAGUE BOARD', nativeOnly: true },
  ] },
  // Two wallets, two destinations — deliberately NOT one "money" screen. Drip
  // coin buys power-ups; FAAB buys players. They never trade against each
  // other, and a commissioner topping one up must not wonder which they moved.
  { title: 'MONEY', items: [
    { id: 'coin', label: '◈ DRIP COIN' },
    { id: 'faab', label: '💰 FAAB', nativeOnly: true },
  ] },
];

/** ── 🏷 NAME & CREST (0187) ──────────────────────────────────────────────
 *
 *  The league's own identity, and the only place it can be changed. The crest
 *  had a setter already (set_league_avatar); the NAME had none — whatever
 *  create_native_league was handed stood forever, typo and all.
 *
 *  It reads the current values from my_teams rather than taking props: this
 *  sheet can be opened from a commissioner who has no seat, and my_teams
 *  answers for every league the caller is in either way. */
function LeagueIdentityCard({ leagueId }: { leagueId: string }) {
  const t = useTheme();
  const [name, setName] = useState('');
  const [saved, setSaved] = useState('');
  const [avatar, setAvatar] = useState<string | null>(null);
  const [pickOpen, setPickOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    myEnrollments('')
      .then((rows) => {
        const e = rows.find((r) => r.league_id === leagueId);
        if (!e?.league) return;
        setName(e.league.name ?? '');
        setSaved(e.league.name ?? '');
        setAvatar(e.league.avatar_url ?? null);
      })
      .catch(() => {});
  }, [leagueId]);

  const saveName = async () => {
    if (busy) return;
    setBusy(true); setNote(null);
    try {
      const r = await setLeagueName(leagueId, name);
      if (!r.ok) { warn(); setNote(friendlyError(r.error ?? 'that didn’t save')); return; }
      commit();
      // Render what the SERVER kept — it trims and collapses whitespace, so
      // the field would otherwise keep showing the version nobody stored.
      setName(r.name ?? name); setSaved(r.name ?? name);
      setNote('✓ saved — the new name shows everywhere the league appears');
    } catch (e) { warn(); setNote(friendlyError(e)); }
    finally { setBusy(false); }
  };

  const saveAvatar = async (url: string | null) => {
    setPickOpen(false);
    if (busy) return;
    setBusy(true); setNote(null);
    try {
      const r = await setLeagueAvatar(leagueId, url);
      if (!r.ok) { warn(); setNote(friendlyError(r.error ?? 'that didn’t save')); return; }
      commit(); setAvatar(r.avatar ?? null); setNote('✓ crest saved');
    } catch (e) { warn(); setNote(friendlyError(e)); }
    finally { setBusy(false); }
  };

  const dirty = name.trim() !== saved;
  return (
    <Card>
      <Mono size={9} tone="faint" track={0.12}>LEAGUE NAME</Mono>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
        <TextInput value={name} onChangeText={(v) => { setName(v); setNote(null); }}
          maxLength={60} placeholder="league name" placeholderTextColor={t.faint}
          style={{ flex: 1, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 8, fontSize: fs(13), color: t.text, backgroundColor: t.bg }} />
        <Pressable disabled={busy || !dirty || name.trim().length < 2} onPress={() => { tap(); void saveName(); }}
          style={{ backgroundColor: t.you, borderRadius: 7, paddingHorizontal: 14, justifyContent: 'center', opacity: busy || !dirty || name.trim().length < 2 ? 0.5 : 1 }}>
          <Text style={{ fontFamily: MONO, fontSize: fs(9.5), fontWeight: '700', color: t.onAccent }}>SAVE</Text>
        </Pressable>
      </View>
      <Mono size={8.5} tone="faint" style={{ marginTop: 5, lineHeight: fs(12) }}>
        2–60 characters. Everyone in the league sees it — on their leagues list, the header, and every invite.
      </Mono>

      <Mono size={9} tone="faint" track={0.12} style={{ marginTop: 14 }}>LEAGUE CREST</Mono>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 }}>
        {avatar
          ? <Image source={{ uri: avatar }} style={{ width: 40, height: 40, borderRadius: 8, backgroundColor: t.bg }} />
          : <View style={{ width: 40, height: 40, borderRadius: 8, backgroundColor: t.bg, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontSize: fs(16), fontWeight: '700', color: t.faint }}>{(saved || 'L').slice(0, 1).toUpperCase()}</Text>
            </View>}
        <Pressable disabled={busy} onPress={() => { tap(); setPickOpen(true); }}
          style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 7, paddingHorizontal: 12, paddingVertical: 8, opacity: busy ? 0.5 : 1 }}>
          <Text style={{ fontFamily: MONO, fontSize: fs(9.5), fontWeight: '700', color: t.text }}>🖼 PICK A CREST</Text>
        </Pressable>
        {!!avatar && (
          <Pressable disabled={busy} hitSlop={6} onPress={() => { tap(); void saveAvatar(null); }}>
            <Text style={{ fontFamily: MONO, fontSize: fs(9.5), fontWeight: '700', color: t.opp }}>✕ clear</Text>
          </Pressable>
        )}
      </View>
      {!!note && <Mono size={9.5} tone={note.startsWith('✓') ? 'you' : 'opp'} style={{ marginTop: 8 }}>{note}</Mono>}

      <AvatarGrid visible={pickOpen} title="League crest" current={avatar}
        onClose={() => setPickOpen(false)} onPick={(url) => { void saveAvatar(url); }} />
    </Card>
  );
}

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
  // Which destination is open (v0.264.0): null = the map alone. Tapping a
  // chip pops the section up FROM BELOW as a bottom sheet — the app's own
  // idiom (Overlay) over the web console's tap-into-a-lone-panel pattern.
  const [section, setSection] = useState<string | null>(null);
  // The roster builder's drag-to-reorder (v0.267.0) freezes the sheet's
  // scroll while a row rides the finger — two vertical gestures, one winner.
  const [sheetScroll, setSheetScroll] = useState(true);
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
        {/* Wrapped in <Mono>: Notice renders its children into a View, and a
            bare string in a View is a hard RN crash — on the one path (a
            commissioner demoted while this screen is open) where this branch
            actually renders. */}
        <Notice><Mono size={10}>These tools are the commissioner's. You're not this league's commissioner (anymore?) — head back to your leagues.</Mono></Notice>
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
          {/* ⚑ SETTINGS is gone (v0.264.0) — its slices live in the map below
              as ⇄ WAIVERS & TRADES, 🏆 PLAYOFFS and 📣 LEAGUE BOARD. */}
          <Pressable onPress={shareInvite} style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.you, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 8 }}>
            <Text style={{ fontFamily: MONO, fontSize: fs(9.5), fontWeight: '700', color: t.you }}>⇪ RECRUIT</Text>
          </Pressable>
        </View>
        {!!err && <Mono size={10} tone="opp" style={{ marginTop: 6 }}>⚠ {err}</Mono>}
      </Card>

      {/* ── The grouped map (v0.219.0), ported from the web restructure ──
          This screen was one long scroll: kit, seats, activity, mode, buffs,
          coin and players stacked end to end, so finding anything meant
          remembering how far down it lived. Same four groups as the web rail,
          but WRAPPED rather than scrolled — with this few destinations they
          all fit on screen, so nothing hides behind a swipe (the mistake the
          web's phone strip made). One section renders at a time. */}
      <Card>
        {NAV_GROUPS.filter((g) => g.items.some((it) => !it.nativeOnly || native)).map((g) => (
          <View key={g.title} style={{ marginBottom: 6 }}>
            <Mono size={8.5} tone="faint" weight="700" track={0.14}>{g.title}</Mono>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 4 }}>
              {g.items.filter((it) => !it.nativeOnly || native).map((it) => {
                const on = section === it.id;
                return (
                  <Pressable key={it.id} onPress={() => { tap(); setSection(it.id); }}
                    style={{ borderRadius: 3, paddingHorizontal: 9, paddingVertical: 6, backgroundColor: on ? t.you : t.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: on ? t.you : t.bd }}>
                    <Text style={{ fontFamily: MONO, fontSize: fs(9.5), fontWeight: '700', color: on ? t.onAccent : t.dim }}>{it.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}
      </Card>

      {/* ── The section, as a BOTTOM SHEET (v0.264.0) ──
          The map is the screen; a destination pops up from below and slides
          away, so the whole map is always one dismiss from view — the same
          content the web console shows as a lone panel with a back chip,
          presented the way this app presents everything else (Overlay). The
          three ex-⚑ SETTINGS slices keep their own sheet (CommishSettings
          carries their shared loads and save paths). */}
      {section != null && !['waivers', 'playoffs', 'board'].includes(section) && (
        <Overlay visible
          title={NAV_GROUPS.flatMap((g) => g.items).find((it) => it.id === section)?.label ?? section}
          onClose={() => { setSection(null); setSheetScroll(true); }}>
          <ScrollView style={{ flexGrow: 0 }} showsVerticalScrollIndicator={false} nestedScrollEnabled scrollEnabled={sheetScroll}>
            {section === 'identity' && <LeagueIdentityCard leagueId={leagueId} />}
            {section === 'kit' && <CommishToolsCard leagueId={leagueId} />}
            {section === 'seats' && (
              <CommishTeams key={`teams-${epoch}`} leagueId={leagueId} myRoster={myRoster}
                onChanged={() => void refresh()} onSelfUnassigned={onSelfUnassigned} />
            )}
            {section === 'activity' && <CommishSeen leagueId={leagueId} />}
            {section === 'mode' && <GameModeCard leagueId={leagueId} view="mode" />}
            {section === 'lineup' && <GameModeCard leagueId={leagueId} view="lineup" onDragActive={(a) => setSheetScroll(!a)} />}
            {section === 'scoring' && <GameModeCard leagueId={leagueId} view="scoring" />}
            {section === 'buffs' && <LiveBuffsCard leagueId={leagueId} />}
            {section === 'coin' && (
              <>
                <CommishCoin leagueId={leagueId} onChanged={() => { setEpoch((n) => n + 1); void refresh(); }} />
                {/* Per-team balances (v0.220.0). The league-wide levers above move
                    everyone; this answers "who has what" and "give THIS team some"
                    side by side — the same table the web grew in v0.213.2. */}
                <CoinByTeam key={`coin-${epoch}`} leagueId={leagueId} />
              </>
            )}
            {section === 'faab' && native && <FaabWalletsCard leagueId={leagueId} />}
            {section === 'players' && native && <CommishPlayers key={`players-${epoch}`} leagueId={leagueId} onChanged={() => void refresh()} />}
            {section === 'dynasty' && native && <DynastyCard leagueId={leagueId} />}
          </ScrollView>
        </Overlay>
      )}

      {native && (
        <CommishSettings
          visible={section === 'waivers' || section === 'playoffs' || section === 'board'}
          view={section === 'playoffs' ? 'playoffs' : section === 'board' ? 'board' : 'waivers'}
          leagueId={leagueId}
          onClose={() => setSection(null)}
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
    paddingHorizontal: 9, paddingVertical: 6, fontFamily: MONO, fontSize: fs(13), color: t.text, backgroundColor: t.bg,
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
      <Mono size={8.5} tone="faint" style={{ marginTop: 5, lineHeight: fs(13) }}>
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
          <Mono size={8.5} tone="faint" style={{ lineHeight: fs(13) }}>
            Every adjustment here lands on the coin ledger — nothing is edited in place.
          </Mono>
        </View>
        <LinkButton label="⌀ zero all wallets" tone="opp" onPress={() => { tap(); doClear(); }} />
      </View>
    </Card>
  );
}

/** One signed grant, as a sheet — the app's idiom for a per-row money move.
 *
 *  The web puts an amount box and a button INSIDE each table row, which works
 *  when a row has 700px to spend. A phone row has ~340px and has to hold a team
 *  name and a balance, so here the row stays a readout and the typing happens
 *  in a sheet. GRANT / DOCK is a sign TOGGLE rather than a typed minus: the
 *  number pad on iOS has no "−" key, so a signed text field would be
 *  unenterable on the platform this screen mostly runs on. */
function GrantSheet({ visible, title, subtitle, unit, busy, grantLabel, dockLabel, onClose, onSubmit }: {
  visible: boolean; title: string; subtitle: string; unit: string; busy: boolean;
  grantLabel: string; dockLabel: string;
  onClose: () => void; onSubmit: (amount: number) => void;
}) {
  const t = useTheme();
  const [draft, setDraft] = useState('');
  const [sign, setSign] = useState<1 | -1>(1);
  // Fresh sheet, fresh amount — a leftover number from the last team is the
  // one mistake this control must never make.
  useEffect(() => { if (visible) { setDraft(''); setSign(1); } }, [visible]);
  const amt = (parseInt(draft || '0', 10) || 0) * sign;
  return (
    <Overlay visible={visible} title={title} subtitle={subtitle} onClose={onClose}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Chip label={`＋ ${grantLabel}`} on={sign === 1} onPress={() => { tap(); setSign(1); }} />
        <Chip label={`− ${dockLabel}`} on={sign === -1} onPress={() => { tap(); setSign(-1); }} />
        <TextInput value={draft} autoFocus keyboardType="number-pad" placeholder="amount" placeholderTextColor={t.faint}
          onChangeText={(v) => setDraft(v.replace(/\D/g, ''))}
          style={{
            flex: 1, minWidth: 90, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 6,
            paddingHorizontal: 9, paddingVertical: 7, fontFamily: MONO, fontSize: fs(13), color: t.text, backgroundColor: t.bg,
          }} />
      </View>
      <View style={{ marginTop: 10 }}>
        <PrimaryButton label={busy ? '…' : `${amt >= 0 ? '+' : ''}${amt} ${unit}`} disabled={busy || !draft}
          onPress={() => { if (amt) onSubmit(amt); }} />
      </View>
    </Overlay>
  );
}

/** DRIP COIN BY TEAM (v0.220.0) — the web's v0.213.2 table, ported.
 *
 *  Per-seat balances already existed in the app, but only as a 💰 chip on each
 *  SEATS row: to compare two teams you scrolled a seat list reading one number
 *  at a time, and the two coin questions a commissioner actually has ("who has
 *  what", "give that team some") lived on a screen about who has JOINED. One
 *  sorted table answers both. The chip on SEATS stays — it's the right lever
 *  when you're already looking at that seat. */
function CoinByTeam({ leagueId }: { leagueId: string }) {
  const t = useTheme();
  const [seats, setSeats] = useState<AdminMember[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [target, setTarget] = useState<AdminMember | null>(null);

  const load = () => adminLeagueMembers(leagueId).then(setSeats).catch((e) => setNote(friendlyError(e)));
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [leagueId]);

  const grant = async (m: AdminMember, amount: number) => {
    if (busy) return;
    setBusy(true); setNote(null); setTarget(null);
    try {
      const r = await commishSeedCoin(leagueId, m.roster_id, amount);
      if (r.ok) {
        commit();
        setNote(`✓ ${amount > 0 ? '+' : ''}${amount} coin — ${m.team ?? `roster ${m.roster_id}`}`);
        // Reloads ITSELF rather than poking the parent's epoch: that key
        // remounts this card, which would wipe the ✓ the commissioner needs
        // to read. SEATS refetches on its own when you next open it.
        await load();
      } else { warn(); setNote(friendlyError(r.error ?? 'that didn’t work')); }
    } catch (e) { warn(); setNote(friendlyError(e)); }
    finally { setBusy(false); }
  };

  // Richest first — comparison is the whole point of a table.
  const rows = [...(seats ?? [])].sort((a, b) => Number(b.coin ?? 0) - Number(a.coin ?? 0));
  const total = rows.reduce((s, m) => s + Number(m.coin ?? 0), 0);

  return (
    <Card>
      <Mono size={9} tone="faint" track={0.12}>◈ DRIP COIN BY TEAM</Mono>
      {!!note && <Mono size={9.5} tone={note.startsWith('✓') ? 'you' : 'opp'} style={{ marginTop: 5 }}>{note}</Mono>}
      {!seats ? <Mono size={10} tone="faint" style={{ marginTop: 8 }}>Loading…</Mono>
        : rows.length === 0 ? <Mono size={10} tone="faint" style={{ marginTop: 8 }}>No teams yet.</Mono> : (
          <>
            <Mono size={9} tone="dim" style={{ marginTop: 6 }}>
              {rows.length} teams · ◇ {coinFmt(total)} in circulation
            </Mono>
            <View style={{ marginTop: 8, gap: 1 }}>
              {rows.map((m) => (
                <Pressable key={m.roster_id} onPress={() => { tap(); setTarget(m); }}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: 8, backgroundColor: t.bg, borderRadius: 3 }}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={{ fontSize: fs(13), fontWeight: '600', color: t.text }}>
                      {m.team || `Roster ${m.roster_id}`}
                    </Text>
                    {!m.enrolled && <Mono size={8.5} tone="faint" style={{ marginTop: 2 }}>not joined</Mono>}
                  </View>
                  <Text style={{ fontFamily: MONO, fontSize: fs(13), fontWeight: '700', color: Number(m.coin ?? 0) > 0 ? t.you : t.faint }}>
                    ◇ {coinFmt(m.coin)}
                  </Text>
                  <Text style={{ fontFamily: MONO, fontSize: fs(11), color: t.dim }}>›</Text>
                </Pressable>
              ))}
            </View>
            <Mono size={8.5} tone="faint" style={{ marginTop: 8, lineHeight: fs(13) }}>
              Tap a team to grant or dock. Adjustments are additive and immediate, and land on the coin ledger like any other move. DRIP COIN buys power-ups and live buffs — it is NOT the FAAB waiver budget, which has its own wallet under 💰 FAAB.
            </Mono>
          </>
        )}
      <GrantSheet visible={!!target} busy={busy} unit="coin" grantLabel="GRANT" dockLabel="DOCK"
        title={target ? `Adjust coin — ${target.team ?? `roster ${target.roster_id}`}` : ''}
        subtitle={target ? `Current balance: ${coinFmt(target.coin)} coin.` : ''}
        onClose={() => setTarget(null)}
        onSubmit={(amt) => { if (target) void grant(target, amt); }} />
    </Card>
  );
}

/** FAAB WALLETS + GRANTS (0173, ported to the app in v0.220.0).
 *
 *  Every seat's remaining waiver budget, with a grant per team and one to the
 *  whole league. Balances are EFFECTIVE — a seat that has never bid reads the
 *  league default rather than 0 — so "$100" means the same on every row.
 *
 *  Rows keep the RPC's roster_id order rather than sorting by balance: most
 *  seats sit on the same default, so a balance sort would reshuffle ties on
 *  every grant and move the row out from under your thumb. */
// ── Dynasty (0182): keepers + the rollover into next season ──────────────────
// Mirror of the web DynastyPanel. The rollover names the game it carries
// (v0.251.0 rule) — the confirm and the success line both say DRIP or NORMAL.
function DynastyCard({ leagueId }: { leagueId: string }) {
  const t = useTheme();
  const [st, setSt] = useState<KeeperState | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [rookieOnly, setRookieOnly] = useState(false);
  const [picks, setPicks] = useState<PickAssetRow[]>([]);
  const [futureSeason, setFutureSeason] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const seeded = useRef(false);

  const load = async () => {
    const s = await keeperState(leagueId);
    if (s.error || !s.ok) { setNote(friendlyError(s.error ?? 'could not load')); return; }
    setSt(s);
    // a dynasty league's rollover IS the rookie draft — default the toggle on,
    // once, leaving the commissioner's own flips alone afterward
    if (!seeded.current) { seeded.current = true; setRookieOnly(s.continuity === 'dynasty'); }
    const a = await pickAssets(leagueId).catch(() => null);
    if (a?.ok) { setPicks(a.picks); setFutureSeason(a.future_season); }
  };
  useEffect(() => {
    void load().catch((e) => setNote(friendlyError(e)));
    leaguePool(leagueId)
      .then((ps) => setNames(Object.fromEntries(ps.map((p) => [p.slug, p.full_name]))))
      .catch(() => {});
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [leagueId]);
  if (!st) return <Card><Mono size={10} tone="faint">{note ?? 'Loading…'}</Mono></Card>;

  const modeName = st.game_mode === 'classic' ? '🏈 NORMAL' : '◈ DRIP';
  const rolled = !!st.rolled_league_id;
  const drafted = st.draft_status === 'complete';
  // the Super Bowl gate (0185): the rollover appears when the season is over
  const canRoll = !!st.season_over || !!st.admin;
  const contName = st.continuity === 'dynasty' ? '🏰 DYNASTY' : st.continuity === 'keeper' ? '★ KEEPER' : 'REDRAFT';
  const nameOf = (s: string) => names[s] ?? s;
  const futurePicks = futureSeason == null ? [] : picks.filter((p) => p.season >= futureSeason);

  const doRoll = async () => {
    setBusy(true); setNote(null);
    try {
      const r = await rolloverLeague(leagueId, 14, rookieOnly);
      if (r.ok) {
        commit();
        setNote(`✓ rolled into ${r.season} — a ${r.game_mode === 'classic' ? '🏈 NORMAL' : '◈ DRIP'} league, ${r.kept} keepers carried, ${r.draft_rounds}-round draft pending. Invite code ${r.invite_code}.`);
        await load();
      } else { warn(); setNote(friendlyError(r.error ?? 'that didn’t work')); }
    } catch (e) { warn(); setNote(friendlyError(e)); }
    finally { setBusy(false); }
  };
  const roll = () => {
    if (busy || !st.next_season) return;
    const keeps = st.keeper_count > 0
      ? `every team keeps its ${st.keeper_count} (declared first, best-ranked fill the rest) and the draft runs ${st.roster_size - st.keeper_count} rounds`
      : 'every roster redrafts in full';
    Alert.alert(
      `Roll into ${st.next_season}?`,
      `Creates the ${st.next_season} season as a ${modeName} league — same settings, scoring and seats; ${keeps}${rookieOnly ? '; the draft pool is pinned ROOKIES-ONLY (reseed the pool from the draft room before starting)' : ''}. Wallets start fresh. This season stays as history.`,
      [
        { text: 'cancel', style: 'cancel' },
        { text: `roll · ${modeName}`, style: 'default', onPress: () => void doRoll() },
      ],
    );
  };

  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Mono size={9} tone="faint" track={0.12}>🔁 NEXT SEASON</Mono>
        <View style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: st.continuity === 'redraft' ? t.bd : t.you, borderRadius: 4, paddingHorizontal: 7, paddingVertical: 2 }}>
          <Text style={{ fontFamily: MONO, fontSize: fs(8.5), fontWeight: '700', letterSpacing: 0.5, color: st.continuity === 'redraft' ? t.dim : t.you }}>{contName}{st.continuity !== 'redraft' ? ' LEAGUE' : ''}</Text>
        </View>
      </View>
      {!!note && <Mono size={9.5} tone={note.startsWith('✓') ? 'you' : 'opp'} style={{ marginTop: 5, lineHeight: fs(14) }}>{note}</Mono>}

      <Mono size={8.5} tone="faint" style={{ marginTop: 8, lineHeight: fs(13) }}>
        {st.continuity === 'redraft'
          ? 'Nothing carries over — switch to keeper or dynasty under 🎮 MODE.'
          : st.continuity === 'keeper'
            ? `Each team keeps ${st.keeper_count} of ${st.roster_size} into ${st.next_season ?? 'next season'} — change it under 🎮 MODE. Managers declare keepers on their TEAM screen; a seat that declares nothing keeps its best-ranked.`
            : `${st.rookie_rounds ?? 0}-round rookie drafts; each team keeps ${st.keeper_count} of ${st.roster_size} — change it under 🎮 MODE. Managers declare keepers on their TEAM screen; a seat that declares nothing keeps its best-ranked.`}
      </Mono>

      {st.keeper_count > 0 && (
        <>
          <Mono size={9} tone="faint" track={0.12} style={{ marginTop: 12 }}>WHO KEEPS WHOM {rolled ? '(as carried)' : '(as of now)'}</Mono>
          {st.teams.map((tm) => (
            <View key={tm.roster_id} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5, alignItems: 'center', marginTop: 6 }}>
              <Text style={{ fontFamily: MONO, fontSize: fs(11), fontWeight: '700', color: t.text, minWidth: 90 }} numberOfLines={1}>
                {tm.team ?? `Team ${tm.roster_id}`}
              </Text>
              {tm.keep.length === 0
                ? <Mono size={9} tone="faint">rosters arrive at the draft</Mono>
                : tm.keep.map((k) => (
                  <View key={k.slug} style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 5, paddingHorizontal: 7, paddingVertical: 3 }}>
                    <Text style={{ fontFamily: MONO, fontSize: fs(9.5), color: t.dim }}>{k.declared ? '★ ' : ''}{nameOf(k.slug)}</Text>
                  </View>
                ))}
            </View>
          ))}
        </>
      )}

      {futurePicks.length > 0 && (
        <>
          <Mono size={9} tone="faint" track={0.12} style={{ marginTop: 12 }}>ROOKIE DRAFT PICKS · WHO OWNS WHAT</Mono>
          <Mono size={8.5} tone="faint" style={{ marginTop: 4, lineHeight: fs(13) }}>
            Every team’s picks for the next three seasons — tradeable assets that move in ordinary trades; the rollover carries ownership into each season’s rookie draft.
          </Mono>
          {st.teams.map((tm) => {
            const owned = futurePicks.filter((p) => p.owner === tm.roster_id);
            return (
              <View key={`pk-${tm.roster_id}`} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5, alignItems: 'center', marginTop: 6 }}>
                <Text style={{ fontFamily: MONO, fontSize: fs(11), fontWeight: '700', color: t.text, minWidth: 90 }} numberOfLines={1}>
                  {tm.team ?? `Team ${tm.roster_id}`}
                </Text>
                {owned.length === 0
                  ? <Mono size={9} tone="opp">traded every pick away</Mono>
                  : owned.map((p) => (
                    <View key={`${p.season}:${p.round}:${p.orig}`} style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 5, paddingHorizontal: 7, paddingVertical: 3 }}>
                      <Text style={{ fontFamily: MONO, fontSize: fs(9.5), color: t.dim }}>
                        ’{p.season.slice(2)} R{p.round}{p.orig !== p.owner ? ` ⇄ ${st.teams.find((x) => x.roster_id === p.orig)?.team ?? `Team ${p.orig}`}` : ''}
                      </Text>
                    </View>
                  ))}
              </View>
            );
          })}
        </>
      )}

      <Mono size={9} tone="faint" track={0.12} style={{ marginTop: 12 }}>ROLL INTO {st.next_season ?? 'NEXT SEASON'}</Mono>
      {rolled ? (
        <Mono size={9.5} tone="you" style={{ marginTop: 6, lineHeight: fs(14) }}>
          ✓ this season already rolled into {st.next_season}. Open the new league from MY LEAGUES to run its draft.
        </Mono>
      ) : !drafted ? (
        <Mono size={9.5} tone="faint" style={{ marginTop: 6 }}>The rollover opens once this season’s draft is complete.</Mono>
      ) : !canRoll ? (
        // the Super Bowl gate (0185): the option APPEARS when the season ends
        <Mono size={9.5} tone="faint" style={{ marginTop: 6, lineHeight: fs(14) }}>
          🏈 The rollover opens after the Super Bowl{st.next_season ? ` (Feb 15, ${st.next_season})` : ''}. Keeper declarations and pick trades run all season — the roll into {st.next_season ?? 'next season'} appears here when the season is over.
        </Mono>
      ) : (
        <>
          <Pressable onPress={() => { tap(); setRookieOnly((v) => !v); }} disabled={busy}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 8 }}>
            <View style={{ width: 14, height: 14, borderRadius: 3, borderWidth: 1.5, borderColor: rookieOnly ? t.you : t.bd, backgroundColor: rookieOnly ? t.you : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
              {rookieOnly && <Text style={{ fontSize: fs(9), color: t.onAccent, fontWeight: '700' }}>✓</Text>}
            </View>
            <Mono size={9.5} style={{ flex: 1, lineHeight: fs(13) }}>
              rookie draft — next season’s pool is pinned to first-year players (reseed the pool from the draft room before starting it)
            </Mono>
          </Pressable>
          {!!st.admin && !st.season_over && (
            <Mono size={9} tone="warn" style={{ marginTop: 8, lineHeight: fs(13) }}>
              ⚠ admin bypass — the season isn’t over yet; commissioners see this button after the Super Bowl
            </Mono>
          )}
          <View style={{ marginTop: 10 }}>
            <PrimaryButton label={busy ? '…' : `🔁 ROLL INTO ${st.next_season ?? '—'} · ${modeName}`} onPress={roll} disabled={busy} />
          </View>
          <Mono size={8.5} tone="faint" style={{ marginTop: 6, lineHeight: fs(13) }}>
            Creates the {st.next_season} league: same settings and seats, keepers on the rosters, a fresh {st.keeper_count > 0 ? `${st.roster_size - st.keeper_count}-round` : 'full'} draft waiting, schedule generated. Coin wallets start fresh — the weekly budget funds the new season.
          </Mono>
        </>
      )}
    </Card>
  );
}

function FaabWalletsCard({ leagueId }: { leagueId: string }) {
  const t = useTheme();
  const [w, setW] = useState<FaabWallets | null>(null);
  const [mode, setMode] = useState<WaiverMode | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [target, setTarget] = useState<{ roster_id: number | null; team: string | null; faab: number } | null>(null);

  const load = () => leagueFaabWallets(leagueId).then(setW).catch((e) => setNote(friendlyError(e)));
  useEffect(() => {
    void load();
    // The read is mode-independent, but the GRANT is refused outside FAAB —
    // so the mode decides whether the levers are live, not whether the
    // balances show. Hiding the numbers would just make the refusal a mystery.
    rosterRules(leagueId).then((r) => setMode(r.waiver_mode ?? 'rolling')).catch(() => {});
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [leagueId]);

  const grant = async (rosterId: number | null, amount: number) => {
    if (busy) return;
    setBusy(true); setNote(null); setTarget(null);
    try {
      const r = await commishGrantFaab(leagueId, rosterId, amount);
      if (r.ok) {
        commit();
        setNote(rosterId == null ? `✓ ${amount > 0 ? '+' : ''}$${Math.abs(amount)} to every team` : `✓ ${amount > 0 ? '+' : ''}$${Math.abs(amount)} granted`);
        await load();
      } else { warn(); setNote(friendlyError(r.error ?? 'that didn’t work')); }
    } catch (e) { warn(); setNote(friendlyError(e)); }
    finally { setBusy(false); }
  };

  const teams = w?.teams ?? [];
  const live = mode === 'faab';

  return (
    <Card>
      <Mono size={9} tone="faint" track={0.12}>💰 FAAB WALLETS</Mono>
      {!!note && <Mono size={9.5} tone={note.startsWith('✓') ? 'you' : 'opp'} style={{ marginTop: 5 }}>{note}</Mono>}
      {!w ? <Mono size={10} tone="faint" style={{ marginTop: 8 }}>Loading…</Mono>
        : !w.ok ? <Mono size={10} tone="opp" style={{ marginTop: 8 }}>{friendlyError(w.error ?? 'could not load wallets')}</Mono> : (
          <>
            <Mono size={9} tone="dim" style={{ marginTop: 6 }}>
              season budget ${w.budget} · {teams.length} teams · ${teams.reduce((s, x) => s + x.faab, 0).toLocaleString()} unspent
            </Mono>
            {/* Three states, not two: FAAB (levers live), a known non-FAAB
                mode (say WHICH one and why the grant would be refused), and
                mode-unknown — where naming a mode we failed to read would be
                a guess printed as fact. */}
            {mode == null && (
              <Mono size={9} tone="faint" style={{ marginTop: 8 }}>Checking the waiver mode — grants stay locked until it reads back.</Mono>
            )}
            {mode != null && !live && (
              <View style={{ marginTop: 8 }}>
                <Notice tone="warn">
                  <Mono size={9} tone="warn" style={{ lineHeight: fs(13) }}>
                    This league runs {mode === 'standings' ? 'standings-order' : 'rolling-priority'} waivers, so grants are refused. Switch waivers to FAAB in ⚑ SETTINGS first — and note that the switch itself resets every balance to the season budget, which is exactly why a grant made now would evaporate.
                  </Mono>
                </Notice>
              </View>
            )}
            {live && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <Mono size={9} tone="faint">EVERY TEAM</Mono>
                <Chip label="💰 GRANT ALL" disabled={busy || teams.length === 0}
                  onPress={() => { tap(); setTarget({ roster_id: null, team: null, faab: 0 }); }} />
              </View>
            )}
            <View style={{ marginTop: 8, gap: 1 }}>
              {teams.map((x) => (
                <Pressable key={x.roster_id} disabled={!live} onPress={() => { tap(); setTarget(x); }}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: 8, backgroundColor: t.bg, borderRadius: 3, opacity: live ? 1 : 0.75 }}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={{ fontSize: fs(13), fontWeight: '600', color: t.text }}>
                      {x.team || `Roster ${x.roster_id}`}
                    </Text>
                    {!x.touched && <Mono size={8.5} tone="faint" style={{ marginTop: 2 }}>untouched — still on the league default</Mono>}
                  </View>
                  <Text style={{ fontFamily: MONO, fontSize: fs(13), fontWeight: '700', color: x.faab > 0 ? t.you : t.faint }}>
                    ${x.faab.toLocaleString()}
                  </Text>
                  {live && <Text style={{ fontFamily: MONO, fontSize: fs(11), color: t.dim }}>›</Text>}
                </Pressable>
              ))}
            </View>
            <Mono size={8.5} tone="faint" style={{ marginTop: 8, lineHeight: fs(13) }}>
              Grants are additive — a claw-back is a negative, and a balance never drops below $0 (the claim resolver assumes a bid can always be paid). Changing the waiver mode or the season budget resets every balance to the default. FAAB buys players; it is NOT drip coin, which buys power-ups.
            </Mono>
          </>
        )}
      <GrantSheet visible={!!target} busy={busy} unit="FAAB" grantLabel="GRANT" dockLabel="CLAW BACK"
        title={target ? (target.roster_id == null ? 'Grant every team' : `Adjust FAAB — ${target.team ?? `roster ${target.roster_id}`}`) : ''}
        subtitle={target ? (target.roster_id == null
          ? `Applies to all ${teams.length} teams, additively — each keeps whatever it had.`
          : `Current balance: $${target.faab.toLocaleString()}.`) : ''}
        onClose={() => setTarget(null)}
        onSubmit={(amt) => { if (target) void grant(target.roster_id, amt); }} />
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
              <Text numberOfLines={1} style={{ fontSize: fs(12.5), fontWeight: '700', color: t.text }}>
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
              <Text numberOfLines={1} style={{ flex: 1, minWidth: 120, fontSize: fs(12), color: t.text }}>{j.email ?? j.app_user_id.slice(0, 8)}</Text>
              <Chip label="SEAT →" onPress={() => { tap(); setSeatPickFor(j); }} />
            </View>
          ))}
        </View>
      )}
      <Mono size={8.5} tone="faint" style={{ marginTop: 8, lineHeight: fs(13) }}>
        Unassigned teams keep their players and can sit open as long as you like. Assigning by email seats them instantly if they have an account, or holds the seat until they sign in with it.
      </Mono>

      {/* assign → collect the email */}
      <Overlay visible={!!assignFor} title={assignFor ? `Assign ${assignFor.team ?? `roster ${assignFor.roster_id}`}` : ''}
        subtitle="The seat goes to this email — instantly if they have an account, held for them if not." onClose={() => setAssignFor(null)}>
        <TextInput value={emailDraft} autoFocus autoCapitalize="none" autoCorrect={false} keyboardType="email-address"
          placeholder="manager@email.com" placeholderTextColor={t.faint} onChangeText={setEmailDraft}
          style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 9, fontSize: fs(14), color: t.text, backgroundColor: t.bg }} />
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
            style={{ width: 100, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 9, fontFamily: MONO, fontSize: fs(14), color: t.text, backgroundColor: t.bg }} />
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
          style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 9, fontSize: fs(14), color: t.text, backgroundColor: t.bg }} />
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
          style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 9, fontSize: fs(14), color: t.text, backgroundColor: t.bg }} />
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
                  <Text numberOfLines={1} style={{ fontSize: fs(12.5), fontWeight: '700', color: t.text }}>{m.team ?? `Roster ${m.roster_id}`}</Text>
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
              <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, fontSize: fs(12.5), color: t.text }}>{m.name}</Text>
              <Text style={{ fontFamily: MONO, fontSize: fs(10), fontWeight: '700', color: tone(m.last_at) }}>{seenAgoLabel(m.last_at)}</Text>
            </View>
          ))}
          <Mono size={8.5} tone="faint" style={{ marginTop: 2, lineHeight: fs(13) }}>
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
// freezes the mode once the draft starts; its refusal shows inline. CLASSIC
// only offers itself where the founder's per-league flag (0158) is on.
// A builder spot's local draft row: pos/bb plus the PER-SLOT player filter
// (0172) as raw input strings, so partial typing never fights the keyboard.
// `k` is a client-only stable key: drag-to-reorder (v0.267.0) needs row views
// that SURVIVE a reorder — index keys would remount the row mid-gesture and
// kill the pan responder. Never sent to the server (fromSpotDraft ignores it).
type SpotDraft = { k: number; pos: string[]; bb?: boolean; label: string; fTeams: string; fMin: string; fMax: string };
let spotKeySeq = 1;
const toSpotDraft = (x: SlotSpec): SpotDraft => ({
  k: spotKeySeq++,
  pos: [...x.pos], bb: !!x.bb, label: x.label ?? '',
  fTeams: (x.teams ?? []).join(', '),
  fMin: x.min_exp != null ? String(x.min_exp) : '',
  fMax: x.max_exp != null ? String(x.max_exp) : '',
});
const fromSpotDraft = (s: SpotDraft): SlotSpec => {
  const teams = s.fTeams.split(/[\s,]+/).map((t) => t.trim().toUpperCase()).filter(Boolean);
  const mn = s.fMin.trim() === '' ? null : Number(s.fMin);
  const mx = s.fMax.trim() === '' ? null : Number(s.fMax);
  return {
    pos: s.pos, bb: s.bb,
    ...(s.label.trim() ? { label: s.label.trim() } : {}),
    ...(teams.length ? { teams } : {}),
    ...(mn != null && Number.isFinite(mn) ? { min_exp: mn } : {}),
    ...(mx != null && Number.isFinite(mx) ? { max_exp: mx } : {}),
  };
};
const spotHasFlt = (s: SpotDraft) => !!(s.fTeams.trim() || s.fMin.trim() || s.fMax.trim());

// Scoring groups + presets, mirroring the web (v0.219.0) so the two hosts
// describe the catalog the same way. A preset RESETS then applies its deltas,
// and carries the league's receptions setting.
const SCORING_TABS: { id: string; label: string; sections: string[] }[] = [
  { id: 'passing', label: 'PASSING', sections: ['PASSING'] },
  { id: 'receiving', label: 'RECEIVING', sections: ['RECEIVING'] },
  { id: 'rushing', label: 'RUSHING', sections: ['RUSHING'] },
  { id: 'offother', label: 'OTHER', sections: ['COMBINED RUSH + REC', 'FIRST DOWNS BY POSITION'] },
  { id: 'turnovers', label: 'TURNOVERS', sections: ['TURNOVERS & RETURNS', 'SPECIAL TEAMS PLAYER'] },
  { id: 'kicking', label: 'KICKING', sections: ['KICKING', 'PUNTING'] },
  { id: 'defense', label: 'DEFENSE', sections: ['TEAM DEFENSE', 'POINTS ALLOWED', 'YARDAGE ALLOWED'] },
  { id: 'idp', label: 'IDP', sections: ['IDP'] },
  { id: 'coach', label: 'HEAD COACH', sections: ['HEAD COACH'] },
];
const SCORING_PRESETS: { id: string; label: string; ppr: number; over: Record<string, number> }[] = [
  { id: 'std', label: 'STANDARD', ppr: 0, over: {} },
  { id: 'half', label: '½ PPR', ppr: 0.5, over: {} },
  { id: 'full', label: 'FULL PPR', ppr: 1, over: {} },
  { id: 'tep', label: 'TE PREMIUM', ppr: 1, over: { teRec: 0.5 } },
];

// Team-acronym helper (founder ask): a tappable 32-team grid under every teams
// input, kept in SYNC with the free-text field — a chip toggles its code in or
// out of the comma list, and hand-typed codes light their chips.
const ALL_TEAMS = NFL_CODES.map((c) => c.toUpperCase());
const teamList = (s: string) => s.split(/[\s,]+/).map((t) => t.trim().toUpperCase()).filter(Boolean);
const toggleTeam = (s: string, tm: string) => {
  const list = teamList(s);
  return (list.includes(tm) ? list.filter((x) => x !== tm) : [...list, tm]).join(', ');
};
function TeamChips({ value, onChange, disabled }: { value: string; onChange: (next: string) => void; disabled?: boolean }) {
  const t = useTheme();
  const on = new Set(teamList(value));
  return (
    <View style={{ width: '100%', flexDirection: 'row', flexWrap: 'wrap', gap: 3, marginTop: 4 }}>
      {ALL_TEAMS.map((tm) => (
        <Pressable key={tm} disabled={disabled} onPress={() => { tap(); onChange(toggleTeam(value, tm)); }}
          style={{ borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2, backgroundColor: on.has(tm) ? t.you : t.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: on.has(tm) ? t.you : t.bd, opacity: disabled ? 0.5 : 1 }}>
          <Text style={{ fontFamily: MONO, fontSize: fs(8), fontWeight: '700', color: on.has(tm) ? t.onAccent : t.dim }}>{tm}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** One component, three destinations (v0.259.0) — the same shape as the web's
 *  LeagueSettings `view` prop: the state (mode gates everything; the builder
 *  and the scoring drafts load together) stays shared, and `view` only decides
 *  which block renders. */
// ── Continuity (0185): REDRAFT / KEEPER / DYNASTY, in 🎮 MODE ────────────────
// Mirror of the web ContinuityEditor. One selection; the number it needs
// appears beside it; dynasty deals three seasons of tradeable picks on save.
function ContinuityRow({ leagueId }: { leagueId: string }) {
  const t = useTheme();
  const [st, setSt] = useState<KeeperState | null>(null);
  const [cmode, setCmode] = useState<LeagueContinuity>('redraft');
  const [n, setN] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const load = async () => {
    const s = await keeperState(leagueId);
    if (s.error || !s.ok) return;
    setSt(s);
    const m = s.continuity ?? 'redraft';
    setCmode(m);
    setN(m === 'keeper' ? String(s.keeper_count) : m === 'dynasty' ? String(s.rookie_rounds ?? 3) : '');
  };
  useEffect(() => { void load().catch(() => {}); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [leagueId]);
  if (!st) return null;

  const rolled = !!st.rolled_league_id;
  const pick = (m: LeagueContinuity) => {
    if (busy || rolled) return;
    tap(); setCmode(m); setNote(null);
    setN(m === 'keeper' ? String(st.keeper_count || Math.min(4, st.roster_size - 1))
       : m === 'dynasty' ? String(st.rookie_rounds || 3) : '');
  };
  const save = async () => {
    if (busy || rolled) return;
    const num = parseInt(n, 10);
    if (cmode !== 'redraft' && Number.isNaN(num)) return;
    setBusy(true); setNote(null);
    try {
      const r = await setLeagueContinuity(leagueId, cmode, cmode === 'redraft' ? null : num);
      if (r.ok) { commit(); setNote('✓ saved'); await load(); }
      else { warn(); setNote(friendlyError(r.error ?? 'that didn’t work')); }
    } catch (e) { warn(); setNote(friendlyError(e)); }
    finally { setBusy(false); }
  };

  return (
    <View style={{ marginTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd, paddingTop: 10 }}>
      <Mono size={8.5} tone="faint" weight="700" track={0.12}>NEXT SEASON · CONTINUITY</Mono>
      <View style={{ flexDirection: 'row', gap: 5, marginTop: 7, flexWrap: 'wrap', alignItems: 'center' }}>
        <Chip on={cmode === 'redraft'} label="REDRAFT" disabled={busy || rolled} onPress={() => pick('redraft')} />
        <Chip on={cmode === 'keeper'} label="★ KEEPER" disabled={busy || rolled} onPress={() => pick('keeper')} />
        <Chip on={cmode === 'dynasty'} label="🏰 DYNASTY" disabled={busy || rolled} onPress={() => pick('dynasty')} />
        {cmode !== 'redraft' && (
          <TextInput value={n} onChangeText={(v) => setN(v.replace(/\D/g, ''))} keyboardType="number-pad"
            editable={!busy && !rolled}
            style={{ fontFamily: MONO, fontSize: fs(12), color: t.text, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 5, paddingHorizontal: 9, paddingVertical: 5, minWidth: 42, textAlign: 'center' }} />
        )}
        {cmode !== 'redraft' && (
          <Mono size={9} tone="faint">{cmode === 'keeper' ? `keepers of ${st.roster_size}` : 'rookie rounds'}</Mono>
        )}
        <Pressable disabled={busy || rolled} onPress={() => { tap(); void save(); }}
          style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 5, paddingHorizontal: 10, paddingVertical: 6, opacity: busy || rolled ? 0.5 : 1 }}>
          <Text style={{ fontFamily: MONO, fontSize: fs(10), fontWeight: '700', color: t.dim }}>SAVE</Text>
        </Pressable>
      </View>
      <Mono size={8} tone="faint" style={{ marginTop: 5, lineHeight: fs(12) }}>
        {rolled
          ? 'This season already rolled over — continuity is set on the new league.'
          : cmode === 'redraft'
            ? 'Every season starts fresh — a full draft, nothing carries over.'
            : cmode === 'keeper'
              ? 'Each team carries that many players into next season and redrafts the rest. Managers declare keepers on their TEAM screen.'
              : 'Teams keep everyone except the rookie-draft spots and draft rookies each year. Saving deals every team’s picks for the NEXT THREE SEASONS as tradeable assets — see them in 🔁 NEXT SEASON.'}
      </Mono>
      {!!note && <Mono size={9} tone={note.startsWith('✓') ? 'you' : 'opp'} style={{ marginTop: 4 }}>{note}</Mono>}
    </View>
  );
}

function GameModeCard({ leagueId, view = 'mode', onDragActive }: {
  leagueId: string; view?: 'mode' | 'lineup' | 'scoring';
  /** Reorder drag in progress — the hosting sheet freezes its scroll so the
   *  row follows the finger instead of the list following it (v0.267.0). */
  onDragActive?: (active: boolean) => void;
}) {
  const t = useTheme();
  const [mode, setMode] = useState<'drip' | 'classic' | null>(null);
  const [ppr, setPpr] = useState(1);
  const [classicOk, setClassicOk] = useState(false);
  // The roster POSITION BUILDER (0163): draft rows, one SAVE writes the spec.
  const [spots, setSpots] = useState<SpotDraft[] | null>(null);
  const [spotsDirty, setSpotsDirty] = useState(false);
  // Which spot's EDITOR sheet (label / filters / remove) is open (v0.267.0 —
  // the founder's "button to pop up a position label editor"; the 0172 filter
  // popover folded into it so the row itself never wraps).
  const [editIdx, setEditIdx] = useState<number | null>(null);
  // ── Drag-to-reorder (v0.267.0, replacing the ▲▼ arrows) ──
  // One drag at a time: the lifted row's key (styling), its live index (ref —
  // gesture handlers read refs so re-renders mid-drag never go stale), the
  // per-key measured heights (rows vary), and the accumulated offset of rows
  // already crossed, so the transform stays finger-relative after each swap.
  const [dragK, setDragK] = useState<number | null>(null);
  const dragIdxRef = useRef(-1);
  const dragAccum = useRef(0);
  const rowH = useRef<Record<number, number>>({});
  const dragY = useRef(new Animated.Value(0)).current;
  // Current key order, refreshed every render AND spliced eagerly on swap, so
  // a fast drag crossing two rows in one frame reads correct neighbours.
  const orderRef = useRef<number[]>([]);
  const [shape, setShape] = useState<{ bench: number; taxi: number; ir: number }>({ bench: 6, taxi: 0, ir: 0 });
  const [rounds, setRounds] = useState<number | null>(null);
  // 0171: admin-enabled extra positions + the commissioner's pool filter.
  const [extraPos, setExtraPos] = useState<string[]>([]);
  const [fltTeams, setFltTeams] = useState('');
  const [fltMin, setFltMin] = useState('');
  const [fltMax, setFltMax] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // Full classic scoring (0160): string drafts; parse + diff on save.
  const [scTab, setScTab] = useState('passing');
  // K/DST fill (v0.225.0) — optimistic like the web's, since the RPC's only
  // failure mode here is "not the commissioner", which this screen already is.
  const [kdst, setKdstState] = useState<LeagueKdst | null>(null);
  const setKdst2 = async (m: KdstMode) => {
    tap();
    setKdstState((k) => (k ? { ...k, mode: m } : k));
    try { await setKdstMode(leagueId, m); } catch { /* keep the optimistic value */ }
  };
  const [armed, setArmed] = useState<string | null>(null);
  const [scDraft, setScDraft] = useState<Record<string, string>>({});
  const scInit = (over: Record<string, number>) => {
    const d: Record<string, string> = {};
    for (const f of CLASSIC_SCORING_FIELDS) d[f.key] = String(over[f.key] ?? DEFAULT_CLASSIC_SCORING[f.key]);
    setScDraft(d);
  };
  useEffect(() => {
    leagueGameMode(leagueId).then((r) => { if (r.ok) {
      setMode(r.mode ?? 'drip'); setPpr(Number(r.ppr ?? 1)); setClassicOk(r.classic_ok === true); scInit(r.scoring ?? {});
      const legacy = classicSlots(r.roster && Object.keys(r.roster).length ? r.roster : null);
      setSpots(r.slots?.length
        ? r.slots.map(toSpotDraft)
        : legacy.map((d) => toSpotDraft({ pos: [...d.pos], bb: (r.bestball ?? []).includes(d.slot) })));
      setSpotsDirty(false);
      if (r.shape) setShape({ bench: r.shape.bench ?? 6, taxi: r.shape.taxi ?? 0, ir: r.shape.ir ?? 0 });
      setRounds(r.rounds ?? null);
      setExtraPos(r.positions ?? []);
      setFltTeams((r.pool_filter?.teams ?? []).join(', '));
      setFltMin(r.pool_filter?.min_exp != null ? String(r.pool_filter.min_exp) : '');
      setFltMax(r.pool_filter?.max_exp != null ? String(r.pool_filter.max_exp) : '');
    } }).catch(() => {});
    leagueKdst(leagueId).then(setKdstState).catch(() => {});
  }, [leagueId]);
  const saveScoring = async (reset = false) => {
    if (busy) return;
    setBusy(true); setNote(null);
    const over: Record<string, number> = {};
    if (!reset) {
      for (const f of CLASSIC_SCORING_FIELDS) {
        const v = Number(scDraft[f.key]);
        if (Number.isFinite(v) && v !== DEFAULT_CLASSIC_SCORING[f.key]) over[f.key] = v;
      }
    }
    try {
      const r = await setLeagueClassicScoring(leagueId, over);
      if (r.ok) { commit(); scInit(r.scoring ?? {}); setNote('✓ scoring saved'); }
      else { warn(); setNote(r.error ?? 'failed'); }
    } catch { warn(); }
    finally { setBusy(false); }
  };
  // Two clicks to apply — a preset replaces all 155 values (web parity).
  const applyPreset = async (pr: typeof SCORING_PRESETS[number]) => {
    if (busy) return;
    if (armed !== pr.id) { setArmed(pr.id); setNote(`${pr.label} replaces every scoring value — tap again to confirm`); return; }
    setBusy(true); setArmed(null); setNote(null);
    try {
      const m = await setLeagueGameMode(leagueId, 'classic', pr.ppr);
      if (!m.ok) { warn(); setNote(m.error ?? 'failed'); return; }
      setPpr(pr.ppr);
      const r = await setLeagueClassicScoring(leagueId, pr.over);
      if (r.ok) { commit(); scInit(r.scoring ?? {}); setNote(`✓ ${pr.label} applied`); }
      else { warn(); setNote(r.error ?? 'failed'); }
    } catch { warn(); }
    finally { setBusy(false); }
  };
  // ── Drag-to-reorder mechanics (v0.267.0) ──
  // Swap-on-cross: the lifted row translates with the finger; passing more
  // than half of a neighbour swaps with it in state (rows re-layout), and the
  // accumulated height of crossed rows keeps the transform finger-relative.
  // Handlers read refs, never closure state — the gesture outlives re-renders.
  if (spots) orderRef.current = spots.map((s) => s.k);
  const liftRow = (i: number, k: number) => {
    tap();
    dragIdxRef.current = i; dragAccum.current = 0; dragY.setValue(0);
    setDragK(k); setEditIdx(null); onDragActive?.(true);
  };
  const moveRow = (dy: number) => {
    let idx = dragIdxRef.current;
    if (idx < 0) return;
    const ord = orderRef.current;
    let eff = dy - dragAccum.current;
    for (;;) {
      if (eff > 0 && idx < ord.length - 1) {
        const h = rowH.current[ord[idx + 1]] ?? 44;
        if (eff > h * 0.55) {
          const [k] = ord.splice(idx, 1); ord.splice(idx + 1, 0, k);
          setSpots((cur) => { if (!cur) return cur; const n = cur.slice(); const [r] = n.splice(idx, 1); n.splice(idx + 1, 0, r); return n; });
          setSpotsDirty(true); dragAccum.current += h; idx++; eff = dy - dragAccum.current; continue;
        }
      } else if (eff < 0 && idx > 0) {
        const h = rowH.current[ord[idx - 1]] ?? 44;
        if (eff < -h * 0.55) {
          const [k] = ord.splice(idx, 1); ord.splice(idx - 1, 0, k);
          setSpots((cur) => { if (!cur) return cur; const n = cur.slice(); const [r] = n.splice(idx, 1); n.splice(idx - 1, 0, r); return n; });
          setSpotsDirty(true); dragAccum.current -= h; idx--; eff = dy - dragAccum.current; continue;
        }
      }
      break;
    }
    dragIdxRef.current = idx;
    dragY.setValue(eff);
  };
  const dropRow = () => {
    if (dragIdxRef.current < 0) return;
    dragIdxRef.current = -1; dragAccum.current = 0; dragY.setValue(0);
    setDragK(null); onDragActive?.(false); commit();
  };
  // A fresh responder object each render is fine: the grip VIEW is stable
  // (key = sp.k) and RN re-binds its handler props, which read the refs above.
  //
  // THE FOUR EXTRA FLAGS ARE THE FIX for "it just ends up down one spot no
  // matter what" (founder, on-device): inside a ScrollView, Android intercepts
  // any moving vertical touch — the drag survived exactly long enough for the
  // first fast movement to cross one row, then the sheet's scroll stole the
  // responder and the gesture silently died. So the grip must (a) claim the
  // touch in the CAPTURE phase, before the scroller sees it, (b) REFUSE
  // termination requests for the touch's whole life, and (c) block the native
  // scroll component from taking over on Android. The scrollEnabled freeze
  // (onDragActive) stays as the second line of defence.
  const gripPan = (i: number, k: number) => PanResponder.create({
    onStartShouldSetPanResponder: () => !busy,
    onStartShouldSetPanResponderCapture: () => !busy,
    onMoveShouldSetPanResponder: () => !busy,
    onMoveShouldSetPanResponderCapture: () => !busy,
    onPanResponderTerminationRequest: () => false,
    onShouldBlockNativeResponder: () => true,
    onPanResponderGrant: () => liftRow(i, k),
    onPanResponderMove: (_e, g) => moveRow(g.dy),
    onPanResponderRelease: dropRow,
    onPanResponderTerminate: dropRow,
  }).panHandlers;

  const saveSpots = async () => {
    if (busy || !spots || !spots.length) return;
    setBusy(true); setNote(null);
    try {
      const r = await setLeagueClassicSlots(leagueId, spots.map(fromSpotDraft));
      if (r.ok) { commit(); setSpots(r.slots ? r.slots.map(toSpotDraft) : spots); setSpotsDirty(false); setNote('✓ lineup saved'); }
      else { warn(); setNote(r.error ?? 'failed'); }
    } catch { warn(); }
    finally { setBusy(false); }
  };
  const saveShape = async (next: { bench: number; taxi: number; ir: number }) => {
    if (busy) return;
    setBusy(true); setNote(null);
    try {
      const r = await setLeagueRosterShape(leagueId, next.bench, next.taxi, next.ir);
      if (r.ok) { commit(); setShape(r.shape ?? next); setRounds(r.rounds ?? null); setNote('✓ roster shape saved'); }
      else { warn(); setNote(r.error ?? 'failed'); }
    } catch { warn(); }
    finally { setBusy(false); }
  };
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
      <Text style={{ fontFamily: MONO, fontSize: fs(9.5), fontWeight: '700', color: on ? t.onAccent : t.dim }}>{label}</Text>
    </Pressable>
  );
  return (
    <Card>
      {view === 'mode' && (<>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Mono size={9.5} weight="700" track={0.12} tone="faint">🎮 GAME MODE</Mono>
          <Mono size={8.5} tone="faint" style={{ marginTop: 3, lineHeight: fs(12) }}>
            DRIP is the full game. CLASSIC is traditional fantasy — standard scoring, one weekly QB/RB/RB/WR/WR/TE/FLEX/K/DEF lineup, no bonuses or power-ups. Locks once the draft starts.
          </Mono>
        </View>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          <Pill on={mode === 'drip'} label="DRIP" onPress={() => void set('drip')} />
          {(classicOk || mode === 'classic')
            ? <Pill on={mode === 'classic'} label="CLASSIC" onPress={() => void set('classic')} />
            : <Mono size={8} tone="faint" style={{ alignSelf: 'center' }}>CLASSIC{'\n'}not unlocked</Mono>}
        </View>
      </View>
      {/* K/DST FILL (v0.225.0) — a setup decision about what the league
          rosters, so it sits with the game mode exactly as it does on web.
          PORTED DELIBERATELY PARTIALLY: the mode selector is the part that
          decides league behaviour and belongs on a phone; MANUAL's per-team
          assignment is a 32-option dropdown per seat, which is a desk job, so
          it points at the web console rather than pretending to fit. */}
      {kdst && (
        <View style={{ marginTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd, paddingTop: 10 }}>
          <Mono size={8.5} tone="faint" weight="700" track={0.12}>K / D-ST FILL</Mono>
          <Mono size={8.5} tone="faint" style={{ marginTop: 4, lineHeight: fs(12) }}>
            {kdst.needs_k || kdst.needs_def
              ? `This league doesn't roster ${[kdst.needs_k && 'kickers', kdst.needs_def && 'defenses'].filter(Boolean).join(' or ')} — fill them so the Banker / Suppress metrics are playable. Takes effect on the next sync.`
              : 'This league rosters both K and DEF — no fill needed.'}
          </Mono>
          <View style={{ flexDirection: 'row', gap: 5, marginTop: 7, flexWrap: 'wrap' }}>
            {(['off', 'random', 'manual'] as KdstMode[]).map((m) => (
              <Pill key={m} on={kdst.mode === m} label={m === 'off' ? 'OFF' : m === 'random' ? 'RANDOM WEEKLY' : 'MANUAL'}
                onPress={() => void setKdst2(m)} />
            ))}
          </View>
          {kdst.mode === 'manual' && (
            <Mono size={8} tone="warn" style={{ marginTop: 6, lineHeight: fs(12) }}>
              Manual is on, but the per-team K/DEF picker is web-only — assign them from the league console. Any team left blank falls back to a random not-on-bye pick.
            </Mono>
          )}
        </View>
      )}
      {/* CONTINUITY (0185): redraft / keeper / dynasty — what carries into
          next season. Lives here per the founder ("put it in mode and
          season"); 🔁 NEXT SEASON shows the consequences. */}
      <ContinuityRow leagueId={leagueId} />
      {/* The RECEPTIONS pills moved into the scoring presets (web parity) —
          receptions are a scoring decision. */}
      {mode === 'classic' && (
        <Mono size={8} tone="faint" style={{ marginTop: 8, lineHeight: fs(12) }}>
          The lineup lives under 🧩 ROSTER; receptions and every other value under ⚖ SCORING.
        </Mono>
      )}
      </>)}
      {view === 'lineup' && mode !== 'classic' && mode !== null && (
        <Mono size={8.5} tone="faint" style={{ lineHeight: fs(12) }}>
          A DRIP league has no lineup builder — everyone fields 8 weekly starters, any position. Roster size and position caps live on the web console's ROSTER tab.
        </Mono>
      )}
      {view === 'scoring' && mode !== 'classic' && mode !== null && (
        <Mono size={8.5} tone="faint" style={{ lineHeight: fs(12) }}>
          DRIP scoring is the metric catalog — it has no per-stat values to tune here. Switch the league to CLASSIC under 🎮 MODE for the full scoring editor.
        </Mono>
      )}
      {view === 'lineup' && mode === 'classic' && spots && (
        <View>
          {/* Roster POSITION BUILDER (0163, the founder's sketch): a row per
              starting spot — its own eligible positions + best-ball flag. */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Mono size={8.5} tone="faint" weight="700">🧩 ROSTER BUILDER · {spots.length} STARTING SPOTS</Mono>
            {spotsDirty && <Pill on label="SAVE LINEUP" onPress={() => void saveSpots()} />}
          </View>
          <View style={{ gap: 5, marginTop: 6 }}>
            {spots.map((sp, i) => {
              const dragging = dragK === sp.k;
              const marked = spotHasFlt(sp) || !!sp.label.trim();
              return (
                // Stable key (sp.k): a reorder must NOT remount the row — the
                // active pan responder lives on its grip view.
                <Animated.View key={sp.k}
                  onLayout={(e) => { rowH.current[sp.k] = e.nativeEvent.layout.height + 5; }}
                  style={[
                    { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: StyleSheet.hairlineWidth, borderColor: dragging ? t.you : t.bd, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 5, backgroundColor: t.surface },
                    dragging ? { transform: [{ translateY: dragY }], zIndex: 10, elevation: 6, shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } } : null,
                  ]}>
                  {/* the DRAG GRIP (v0.267.0) — hold and move to reorder;
                      replaced the ▲▼ arrows */}
                  <View {...gripPan(i, sp.k)} hitSlop={10} style={{ paddingHorizontal: 3, paddingVertical: 6 }}>
                    <Text style={{ fontFamily: MONO, fontSize: fs(11), fontWeight: '700', color: dragging ? t.you : t.faint }}>⠿</Text>
                  </View>
                  <Mono size={8.5} weight="700" tone="dim" style={{ width: 18 }}>{i + 1}</Mono>
                  {/* the chips get the row's flexible middle; controls stay
                      pinned right so the ROW never wraps (founder). A custom
                      label reads as its own line inside the card. */}
                  <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                    {[...BUILDER_POSITIONS.filter((q) => !['DL','LB','DB'].includes(q) || extraPos.includes('IDP')), ...['FB','HC','P','RET'].filter((q) => extraPos.includes(q))].map((p) => {
                      const on = sp.pos.includes(p);
                      // A lit chip wears the POSITION's colour (v0.216.1) — same
                      // palette PosPill uses, so the builder speaks the draft
                      // board's language. Unknown tokens fall back to neutral.
                      const c = t.pos[p as keyof typeof t.pos] ?? { bg: t.you, fg: t.onAccent, bd: t.you };
                      return (
                        <Pressable key={p} disabled={busy}
                          onPress={() => { tap(); setSpots((cur) => cur!.map((x, j) => j !== i ? x : { ...x, pos: on ? x.pos.filter((q) => q !== p) : [...x.pos, p] })); setSpotsDirty(true); }}
                          style={{ borderRadius: 3, paddingHorizontal: 5, paddingVertical: 3, backgroundColor: on ? c.bg : t.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: on ? c.bd : t.bd }}>
                          <Text style={{ fontFamily: MONO, fontSize: fs(8), fontWeight: '700', color: on ? c.fg : t.dim }}>{p}</Text>
                        </Pressable>
                      );
                    })}
                    {!!sp.label.trim() && (
                      <Mono size={7.5} tone="you" numberOfLines={1} style={{ width: '100%' }}>“{sp.label.trim()}”</Mono>
                    )}
                  </View>
                  <Pressable disabled={busy}
                    onPress={() => { tap(); setSpots((cur) => cur!.map((x, j) => j !== i ? x : { ...x, bb: !x.bb })); setSpotsDirty(true); }}
                    style={{ borderRadius: 999, paddingHorizontal: 6, paddingVertical: 3, backgroundColor: sp.bb ? t.you : t.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: sp.bb ? t.you : t.bd }}>
                    <Text style={{ fontFamily: MONO, fontSize: fs(8), fontWeight: '700', color: sp.bb ? t.onAccent : t.dim }}>🎯</Text>
                  </Pressable>
                  {/* the spot EDITOR (v0.267.0): label, filters, remove — one
                      button popping a sheet, instead of three inline controls */}
                  <Pressable disabled={busy} onPress={() => { tap(); setEditIdx(i); }}
                    style={{ borderRadius: 999, paddingHorizontal: 7, paddingVertical: 3, backgroundColor: marked ? t.you : t.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: marked ? t.you : t.bd }}>
                    <Text style={{ fontFamily: MONO, fontSize: fs(8), fontWeight: '700', color: marked ? t.onAccent : t.dim }}>✏️</Text>
                  </Pressable>
                </Animated.View>
              );
            })}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
            <Pill on={false} label="＋ ADD SPOT" onPress={() => { if (spots.length < 20) { setSpots((cur) => [...cur!, { k: spotKeySeq++, pos: ['RB', 'WR', 'TE'], label: '', fTeams: '', fMin: '', fMax: '' }]); setSpotsDirty(true); } }} />
            <Mono size={7.5} tone="faint">⠿ drag to reorder · 🎯 best-ball fills itself · ✏️ name the spot + limit who fills it</Mono>
          </View>

          {/* ── The SPOT EDITOR sheet (v0.267.0): the founder's "button to pop
              up a position label editor". Label front and center; the 0172
              per-slot filters and the remove action ride along, so the row
              itself stays one clean line. Edits are live; SAVE LINEUP applies. */}
          <Overlay visible={editIdx != null && editIdx < spots.length}
            title={`✏️ Spot ${(editIdx ?? 0) + 1}`}
            subtitle="Name it, limit who may fill it, or remove it — then SAVE LINEUP."
            onClose={() => setEditIdx(null)}>
            {editIdx != null && spots[editIdx] && (() => { const sp = spots[editIdx]; const i = editIdx; return (
              <View>
                <Mono size={9} tone="faint" weight="700" track={0.12}>LABEL</Mono>
                <TextInput value={sp.label} autoFocus maxLength={24}
                  onChangeText={(v) => { setSpots((cur) => cur!.map((x, j) => j !== i ? x : { ...x, label: v.slice(0, 24) })); setSpotsDirty(true); }}
                  placeholder={`e.g. FLEX, Only NFC Players — empty = ${sp.pos.join('/')}`} placeholderTextColor={t.faint}
                  style={{ fontFamily: MONO, fontSize: fs(13), color: t.text, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 8, marginTop: 6, backgroundColor: t.bg }} />
                <Mono size={8.5} tone="faint" style={{ marginTop: 5, lineHeight: fs(13) }}>
                  Shows on the draft board and lineups in place of the position list. The position chips and the filters below decide who may actually fill it.
                </Mono>

                <Mono size={9} tone="faint" weight="700" track={0.12} style={{ marginTop: 14 }}>WHO MAY FILL IT (0172)</Mono>
                <TextInput value={sp.fTeams}
                  onChangeText={(v) => { setSpots((cur) => cur!.map((x, j) => j !== i ? x : { ...x, fTeams: v })); setSpotsDirty(true); }}
                  placeholder="teams (KC, SF…) — empty = all" placeholderTextColor={t.faint}
                  style={{ fontFamily: MONO, fontSize: fs(11), color: t.text, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 6, marginTop: 6 }} />
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 }}>
                  <Mono size={9} tone="faint">TENURE</Mono>
                  <TextInput value={sp.fMin}
                    onChangeText={(v) => { setSpots((cur) => cur!.map((x, j) => j !== i ? x : { ...x, fMin: v })); setSpotsDirty(true); }}
                    placeholder="min" keyboardType="number-pad" placeholderTextColor={t.faint}
                    style={{ fontFamily: MONO, fontSize: fs(11), color: t.text, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 6, width: 60, textAlign: 'center' }} />
                  <TextInput value={sp.fMax}
                    onChangeText={(v) => { setSpots((cur) => cur!.map((x, j) => j !== i ? x : { ...x, fMax: v })); setSpotsDirty(true); }}
                    placeholder="max" keyboardType="number-pad" placeholderTextColor={t.faint}
                    style={{ fontFamily: MONO, fontSize: fs(11), color: t.text, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 6, width: 60, textAlign: 'center' }} />
                  <Mono size={8} tone="faint" style={{ flex: 1 }}>years — rookies = max 0 (tenure needs a pool re-seed)</Mono>
                </View>
                <View style={{ marginTop: 6 }}>
                  <TeamChips value={sp.fTeams} disabled={busy}
                    onChange={(v) => { setSpots((cur) => cur!.map((x, j) => j !== i ? x : { ...x, fTeams: v })); setSpotsDirty(true); }} />
                </View>

                <View style={{ marginTop: 16, alignItems: 'center' }}>
                  {spots.length > 1
                    ? <LinkButton label="✕ remove this spot" tone="opp"
                        onPress={() => { tap(); setEditIdx(null); setSpots((cur) => cur!.filter((_, j) => j !== i)); setSpotsDirty(true); }} />
                    : <Mono size={8.5} tone="faint">the last spot can’t be removed</Mono>}
                </View>
              </View>
            ); })()}
          </Overlay>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            {([['BENCH', 'bench', 20], ['TAXI', 'taxi', 8], ['IR', 'ir', 8]] as const).map(([label, key, max]) => (
              <View key={key} style={{ flexDirection: 'row', alignItems: 'center', gap: 3, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 3 }}>
                <Text style={{ fontFamily: MONO, fontSize: fs(8.5), fontWeight: '700', color: t.dim }}>{label}</Text>
                <Pressable disabled={busy || shape[key] === 0} onPress={() => { tap(); void saveShape({ ...shape, [key]: Math.max(0, shape[key] - 1) }); }} hitSlop={6}>
                  <Text style={{ fontFamily: MONO, fontSize: fs(11), color: t.you }}> − </Text>
                </Pressable>
                <Text style={{ fontFamily: MONO, fontSize: fs(9.5), fontWeight: '700', color: t.you, minWidth: 12, textAlign: 'center' }}>{shape[key]}</Text>
                <Pressable disabled={busy || shape[key] >= max} onPress={() => { tap(); void saveShape({ ...shape, [key]: Math.min(max, shape[key] + 1) }); }} hitSlop={6}>
                  <Text style={{ fontFamily: MONO, fontSize: fs(11), color: t.you }}> ＋ </Text>
                </Pressable>
              </View>
            ))}
            <Mono size={8.5} weight="700" tone="you">DRAFT = {rounds ?? spots.length + shape.bench + shape.taxi + shape.ir} ROUNDS</Mono>
          </View>
          <Mono size={8} tone="faint" style={{ marginTop: 5, lineHeight: fs(12) }}>
            Any position combination per spot · 🎯 BB fills itself · 🔎 limits who may fill the spot (teams / tenure — tenure filters need a pool re-seed) · you draft the whole roster (starters + bench + taxi + IR), then stash · IR needs a real IR/Out designation · stashed players can't start · locks at draft.
          </Mono>
          {extraPos.length > 0 && (
            <Mono size={8} tone="you" style={{ marginTop: 4 }}>UNLOCKED: {extraPos.join(' · ')} — refresh the player pool (draft room) after changes.</Mono>
          )}
          {/* PLAYER FILTERS (0171): pool allow-list — teams + tenure window. */}
          <View style={{ marginTop: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 6, padding: 8 }}>
            <Mono size={8.5} tone="faint" weight="700">🔎 PLAYER FILTERS · who's allowed in the pool</Mono>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
              <TextInput value={fltTeams} onChangeText={setFltTeams} placeholder="teams (KC, SF…) — empty = all" placeholderTextColor={t.faint}
                style={{ fontFamily: MONO, fontSize: fs(10), color: t.text, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 5, paddingHorizontal: 7, paddingVertical: 5, flexGrow: 1, minWidth: 150 }} />
              <TextInput value={fltMin} onChangeText={setFltMin} placeholder="min yrs" keyboardType="number-pad" placeholderTextColor={t.faint}
                style={{ fontFamily: MONO, fontSize: fs(10), color: t.text, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 5, paddingHorizontal: 7, paddingVertical: 5, width: 62 }} />
              <TextInput value={fltMax} onChangeText={setFltMax} placeholder="max yrs" keyboardType="number-pad" placeholderTextColor={t.faint}
                style={{ fontFamily: MONO, fontSize: fs(10), color: t.text, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 5, paddingHorizontal: 7, paddingVertical: 5, width: 62 }} />
              <Pressable disabled={busy} onPress={() => { tap(); void (async () => {
                const teams = fltTeams.split(/[\s,]+/).map((x) => x.trim().toUpperCase()).filter(Boolean);
                const mn = fltMin.trim() === '' ? null : Number(fltMin);
                const mx = fltMax.trim() === '' ? null : Number(fltMax);
                const r = await setLeaguePoolFilter(leagueId, (!teams.length && mn == null && mx == null) ? null : { teams: teams.length ? teams : null, min_exp: mn, max_exp: mx });
                setNote(r.ok ? '✓ filter saved — refresh the player pool to apply' : (r.error ?? 'failed'));
              })(); }} style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.you, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 }}>
                <Text style={{ fontFamily: MONO, fontSize: fs(9), fontWeight: '700', color: t.you }}>SAVE</Text>
              </Pressable>
              <TeamChips value={fltTeams} disabled={busy} onChange={setFltTeams} />
            </View>
            <Mono size={7.5} tone="faint" style={{ marginTop: 4, lineHeight: fs(11) }}>
              Rookies only → max 0 · 8+ yr vets → min 8 · empty = clear · applies on pool (re)seed, pre-draft only.
            </Mono>
          </View>
        </View>
      )}
      {view === 'scoring' && mode === 'classic' && (
        <View>
          <Mono size={8.5} tone="faint" weight="700">⚖ SCORING  every value is yours to set</Mono>
          {/* START FROM: the recognised systems, so a standard league isn't 155
              decisions. Carries receptions, which is why the PPR pills left
              the mode row. */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5, alignItems: 'center', marginTop: 6 }}>
            <Mono size={8} tone="faint" weight="700">START FROM</Mono>
            {SCORING_PRESETS.map((pr) => (
              <Pressable key={pr.id} disabled={busy} onPress={() => { tap(); void applyPreset(pr); }}
                style={{ borderRadius: 3, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: armed === pr.id ? t.you : t.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: armed === pr.id ? t.you : t.bd }}>
                <Text style={{ fontFamily: MONO, fontSize: fs(8.5), fontWeight: '700', color: armed === pr.id ? t.onAccent : t.dim }}>{armed === pr.id ? `CONFIRM ${pr.label}` : pr.label}</Text>
              </Pressable>
            ))}
            <Mono size={8} tone="faint">RECEPTIONS: {ppr === 1 ? 'FULL PPR' : ppr === 0.5 ? '½ PPR' : 'NON-PPR'}</Mono>
          </View>
          {/* Groups, not one endless column. */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
            {SCORING_TABS.map((tb) => (
              <Pressable key={tb.id} onPress={() => { tap(); setScTab(tb.id); }}
                style={{ borderRadius: 3, paddingHorizontal: 7, paddingVertical: 4, backgroundColor: scTab === tb.id ? t.you : t.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: scTab === tb.id ? t.you : t.bd }}>
                <Text style={{ fontFamily: MONO, fontSize: fs(8), fontWeight: '700', color: scTab === tb.id ? t.onAccent : t.dim }}>{tb.label}</Text>
              </Pressable>
            ))}
          </View>
          {(
            <>
              {CLASSIC_SCORING_SECTIONS.filter((sec) => (SCORING_TABS.find((tb) => tb.id === scTab)?.sections ?? []).includes(sec.section)).map((sec) => (
                <View key={sec.section} style={{ marginTop: 8 }}>
                  <Mono size={7.5} tone="dim" weight="700" track={0.1}>{sec.section}</Mono>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                    {sec.fields.map((f) => {
                      const changed = Number(scDraft[f.key]) !== DEFAULT_CLASSIC_SCORING[f.key];
                      return (
                        <View key={f.key} style={{ width: '22%', minWidth: 74 }}>
                          <Mono size={7} tone={changed ? 'you' : 'faint'} weight="700">{f.label}{f.perYard ? ' /YD' : ''}</Mono>
                          <TextInput value={scDraft[f.key] ?? ''} keyboardType="numbers-and-punctuation"
                            onChangeText={(v) => setScDraft((d) => ({ ...d, [f.key]: v }))}
                            style={{ fontFamily: MONO, fontSize: fs(11), color: t.text, backgroundColor: t.bg, borderWidth: StyleSheet.hairlineWidth, borderColor: changed ? t.you : t.bd, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 5, marginTop: 2 }} />
                        </View>
                      );
                    })}
                  </View>
                </View>
              ))}
              <View style={{ flexDirection: 'row', gap: 6, marginTop: 8 }}>
                <Pill on label="SAVE SCORING" onPress={() => void saveScoring()} />
                <Pill on={false} label="RESET TO STANDARD" onPress={() => void saveScoring(true)} />
              </View>
            </>
          )}
        </View>
      )}
      {note && <Mono size={9} tone={note.startsWith('✓') ? 'faint' : 'warn'} style={{ marginTop: 8 }}>{note}</Mono>}
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
          <Mono size={8.5} tone="faint" style={{ marginTop: 3, lineHeight: fs(12) }}>
            The armed live buffs — overtime, momentum, amps, counters. Off blocks new arms league-wide; already-armed buffs stay reclaimable.
          </Mono>
        </View>
        <Pressable disabled={on === null || busy} onPress={() => { tap(); void flip(); }}
          style={{ borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7, backgroundColor: on ? t.you : t.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: on ? t.you : t.bd, opacity: on === null || busy ? 0.5 : 1 }}>
          <Text style={{ fontFamily: MONO, fontSize: fs(10), fontWeight: '700', color: on ? t.onAccent : t.dim }}>
            {on === null ? '…' : on ? 'ON' : 'OFF'}
          </Text>
        </Pressable>
      </View>
    </Card>
  );
}
