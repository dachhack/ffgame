// The commissioner's kit, as its own tab — COMMISH.
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
  adminAssignRoster, adminLeagueJoiners, setLeagueWaitlist, adminLeagueMembers, commishBulkCoin,
  commishClaimRoster, commishClearCoin, commishGrantWeeklyBudget, commishOverview,
  commishSeedCoin, commishSetManager, commishSetWeeklyBudget, friendlyError, leaguePracticeWeek,
  leagueInvite, nativeTeamState,
  setTeamAvatar, setTeamController, setTeamDivision, setTeamName, teamManagers,
  type AdminMember, type LeagueJoiner, type NativeTeamState, type TeamManagerRow,
  leagueLastSeen, seenAgoLabel, leagueLiveBuffs, setLeagueLiveBuffs, type LeagueSeenRow,
  leagueGameMode, setLeagueGameMode, setLeagueClassicScoring, setLeagueClassicSlots, setLeagueRosterShape, setLeaguePoolFilter,
  setLeagueGolf,
  setTaxiRules, setIrRules,
  leagueKdst, setKdstMode, type LeagueKdst, type KdstMode,
  leagueFaabWallets, commishGrantFaab, rosterRules, type FaabWallets, type WaiverMode,
  leagueContracts, setContractRules, setSalaryRules, setRookieYears, type LeagueContracts,
  setLeagueFormat, setVampires, guillotineState, vampireState, type LeagueFormat, type VampireState,
  playerFlags,
  keeperState, rolloverLeague, leaguePool, type KeeperState,
  pickAssets, type PickAssetRow,
  setLeagueContinuity, type LeagueContinuity, isDynastyContinuity,
  setLeagueName, setLeagueAvatar, myEnrollments, commishDeleteLeague,
} from '@drip/core/data/liveApi';
import { inviteMessage } from '@drip/core/data/invite';
import { classicSlots, CLASSIC_SCORING_SECTIONS, CLASSIC_SCORING_FIELDS, DEFAULT_CLASSIC_SCORING, type SlotSpec } from '@drip/core/engine/classic';
import { NFL_CODES } from '@drip/core/data/kdst';

// The builder's position chips (0163) — combos are made by lighting several.
const BUILDER_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB'];

// ── PRE-BAKED SPOTS (v0.351.0, founder's list) ───────────────────────────────
// One tap adds a fully-configured exotic spot — the 0172 filters and the
// best-ball flag were always expressive enough for these; what was missing
// was not having to hand-assemble them. Conference lists use the pool's own
// team vocabulary (normTeam: LA, WAS, JAX, LV…).
const AFC_TEAMS = 'BUF, MIA, NE, NYJ, BAL, CIN, CLE, PIT, HOU, IND, JAX, TEN, DEN, KC, LV, LAC';
const NFC_TEAMS = 'DAL, NYG, PHI, WAS, CHI, DET, GB, MIN, ATL, CAR, NO, TB, ARI, LA, SEA, SF';
const SPOT_PRESETS: { chip: string; pos: string[]; label: string; bb?: boolean; fMin?: string; fMax?: string; fTeams?: string }[] = [
  { chip: 'ROOKIE SFLX', pos: ['QB', 'RB', 'WR', 'TE'], label: 'Rookie Superflex', bb: true, fMax: '0' },
  { chip: 'ROOKIE FLEX', pos: ['RB', 'WR', 'TE'], label: 'Rookie Flex', bb: true, fMax: '0' },
  { chip: 'BB KICKER', pos: ['K'], label: 'Best-ball K', bb: true },
  { chip: 'BB D/ST', pos: ['DEF'], label: 'Best-ball D/ST', bb: true },
  { chip: 'NFC SFLX', pos: ['QB', 'RB', 'WR', 'TE'], label: 'NFC Superflex', fTeams: NFC_TEAMS },
  { chip: 'AFC SFLX', pos: ['QB', 'RB', 'WR', 'TE'], label: 'AFC Superflex', fTeams: AFC_TEAMS },
  { chip: 'VET 8+ SFLX', pos: ['QB', 'RB', 'WR', 'TE'], label: 'Vet 8+ Superflex', fMin: '8' },
  { chip: 'VET 8+ FLEX', pos: ['RB', 'WR', 'TE'], label: 'Vet 8+ Flex', fMin: '8' },
];
import { useTheme, MONO, fs } from '../theme.native';
import { useLeagueScroll } from '../ui/scrollChrome';
import { tap, commit, warn } from '../ui/feedback';
import { Card, Chip, Display, LinkButton, Mono, Notice, PrimaryButton } from '../ui/prims';
import { Overlay } from '../ui/Overlay';
import { InfoChip, LabelInfo } from '../ui/InfoChip';
import { AvatarGrid } from '../ui/AvatarGrid';
import { CommishSettings } from '../ui/CommishSettings';
import { CommishPlayers } from '../ui/LeagueExtras';
import { CommishToolsCard } from '../ui/CommishKit';

// The app's commissioner map — the same grouping as the web side rail, so a
// commissioner who learns one host already knows the other. `nativeOnly`
// hides what a Sleeper-backed league manages on its own platform.
const NAV_GROUPS: { title: string; items: { id: string; label: string; nativeOnly?: boolean; dripOnly?: boolean; contractOnly?: boolean }[] }[] = [
  // MODE & SCORING was ONE mega-scroll (mode toggle + roster builder + the
  // ~36-knob catalog stacked); the scoring knobs lived two screens below the
  // fold. Split three ways (v0.259.0) to match the web rail exactly.
  { title: 'SET UP', items: [
    // 0187: the league's own identity — the name had NO setter at all before
    // this, so a typo at creation was permanent for every member.
    { id: 'identity', label: 'NAME & CREST' },
    { id: 'mode', label: 'MODE' },
    { id: 'lineup', label: 'ROSTER' },
    { id: 'scoring', label: 'SCORING' },
    // the old SETTINGS overlay, folded into the map (v0.264.0) — each slice
    // is its own destination, mirroring the web console's sections
    { id: 'waivers', label: 'WAIVERS & TRADES', nativeOnly: true },
    { id: 'format', label: 'FORMAT', nativeOnly: true },
  ] },
  { title: 'RUN THE SEASON', items: [
    { id: 'seats', label: 'SEATS' },
    { id: 'players', label: 'PLAYERS', nativeOnly: true },
    { id: 'playoffs', label: 'PLAYOFFS', nativeOnly: true },
    { id: 'dynasty', label: 'NEXT SEASON', nativeOnly: true },
  ] },
  { title: 'ENGAGE', items: [
    { id: 'kit', label: 'KIT' },
    { id: 'activity', label: 'ACTIVITY' },
    // CLASSIC LEAGUES DON'T PLAY WITH COIN (v0.297.3, founder: "classic
    // leagues won't use power ups so they don't need that on the league menu.
    // They don't need drip coin either"). Coin exists to buy power-ups; a
    // classic league has neither, so both destinations leave its map.
    { id: 'buffs', label: 'POWER-UPS', dripOnly: true },
    { id: 'board', label: 'LEAGUE BOARD', nativeOnly: true },
  ] },
  // Two wallets, two destinations — deliberately NOT one "money" screen. Drip
  // coin buys power-ups; FAAB buys players. They never trade against each
  // other, and a commissioner topping one up must not wonder which they moved.
  { title: 'MONEY', items: [
    { id: 'coin', label: 'DRIP COIN', dripOnly: true },
    { id: 'faab', label: 'FAAB', nativeOnly: true },
    // CONTRACTS, NOT MERELY NATIVE (founder: "there's salary in the commish
    // menu in a non-contract league"). nativeOnly was the wrong gate: every
    // native league is native, and only a contract one has a cap to run. The
    // screen behind it already knew — it opens on "OFF — this league plays
    // without contracts" — so the menu was offering a room to be told no.
    { id: 'contracts', label: 'SALARY', nativeOnly: true, contractOnly: true },
  ] },
  // Its own group, at the bottom, with nothing else in it (0188). Deleting a
  // league is the only commissioner action that cannot be undone by another
  // commissioner action, so it does not share a heading with anything you
  // might have been aiming for.
  { title: 'DANGER', items: [
    { id: 'delete', label: 'DELETE LEAGUE' },
  ] },
];

/** ── NAME & CREST (0187) ──────────────────────────────────────────────
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

export function CommishTools({ leagueId, native, rosterId, initialSection, onBack, onSelfUnassigned }: {
  leagueId: string;
  /** Open on a destination rather than the map — creating a league lands on
   *  ROSTER (v0.296.6), because the draft drafts the roster the league is
   *  SHAPED for and both freeze when it starts. */
  initialSection?: string | null;
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
  const chromeScroll = useLeagueScroll();   // the shell's folding chrome (v0.356.0)
  const [team, setTeam] = useState<NativeTeamState | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Which destination is open (v0.264.0): null = the map alone. Tapping a
  // chip pops the section up FROM BELOW as a bottom sheet — the app's own
  // idiom (Overlay) over the web console's tap-into-a-lone-panel pattern.
  const [section, setSection] = useState<string | null>(initialSection ?? null);
  // The roster builder's drag-to-reorder (v0.267.0) freezes the sheet's
  // scroll while a row rides the finger — two vertical gestures, one winner.
  const [sheetScroll, setSheetScroll] = useState(true);
  // Remount lever for the child cards after a settings save — rules changes
  // (roster caps, coin budget) alter what CommishPlayers/CommishTeams show.
  const [epoch, setEpoch] = useState(0);
  // Drip or classic: a classic league's map drops the coin and power-up
  // destinations (v0.297.3). False until the read lands — a menu that pops
  // items IN reads worse than one that briefly offers a room you don't need.
  const [classic, setClassic] = useState(false);
  // Does this league run a salary cap? Same shape as `classic` above, and
  // false until the read lands for the same reason: a menu that pops an item
  // IN reads worse than one that briefly omits a room you may not need.
  const [contracts, setContracts] = useState(false);

  const refresh = async () => {
    if (!native) return; // native_team_state is a native-league RPC
    try {
      const tm = await nativeTeamState(leagueId);
      if (tm.error) { setErr(friendlyError(tm.error)); return; }
      setTeam(tm); setErr(null);
    } catch (x) { setErr(friendlyError(x)); }
  };
  useEffect(() => {
    void refresh();
    leagueGameMode(leagueId).then((g) => { if (g.ok) setClassic(g.mode === 'classic'); }).catch(() => {});
    leagueContracts(leagueId).then((c) => setContracts(!!c.contracts)).catch(() => {});
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [leagueId]);

  const myRoster = native ? (team?.my_roster_id ?? null) : rosterId;

  // The same OS share sheet MY TEAM's RECRUIT opens — a commissioner filling
  // seats is this button's whole audience, so it lives here too.
  const shareInvite = async () => {
    tap();
    try {
      const r = await leagueInvite(leagueId);
      if (!r.ok || !r.invite_code) { warn(); setErr(friendlyError(r.error ?? 'could not fetch the invite code')); return; }
      // One message from every surface (v0.291.0) — and a LINK rather than four
      // characters to dictate. `?code=` was already a complete join path; these
      // buttons just weren't building the URL.
      await Share.share({
        message: inviteMessage({ league: r.name, code: r.invite_code, seatsOpen: r.seats_open, game: r.game_mode }),
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
    <ScrollView style={{ flex: 1 }} {...chromeScroll} contentContainerStyle={{ padding: 12, paddingBottom: 104, gap: 10 }}>
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Display size={17}>Commissioner</Display>
            <Mono size={9} tone="faint" style={{ marginTop: 3 }}>
              {!native
                ? 'Rosters and rules live on Sleeper — seats, co-managers and coin are managed here.'
                : myRoster != null ? 'You also manage a team — that stays in MY TEAM.' : 'You run this league without a team in it.'}
            </Mono>
          </View>
          {/* SETTINGS is gone (v0.264.0) — its slices live in the map below
              as WAIVERS & TRADES, PLAYOFFS and LEAGUE BOARD. */}
          <Pressable onPress={shareInvite} style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.you, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 8 }}>
            <Text style={{ fontFamily: MONO, fontSize: fs(9.5), fontWeight: '700', color: t.you }}>RECRUIT</Text>
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
        {NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((it) => (!it.nativeOnly || native) && (!it.dripOnly || !classic) && (!it.contractOnly || contracts)) }))
          .filter((g) => g.items.length > 0).map((g) => (
          <View key={g.title} style={{ marginBottom: 10 }}>
            <Mono size={8.5} tone="faint" weight="700" track={0.14}>{g.title}</Mono>
            {/* TWO FIXED COLUMNS, not an intrinsic-width wrap (v0.337.1).
                Content-sized chips wrapped raggedly — SET UP broke 3-then-2
                and RUN THE SEASON 3-then-1, so every group ended on a short
                line and no two labels shared a left edge. `space-between` +
                a ~half width gives two straight columns: the emoji all line
                up, and a group with an odd count leaves its gap on the right
                instead of scattering it. Measured at the widest label
                (WAIVERS & TRADES, 147dp at this type size) against the
                narrowest track this grid produces. */}
            {/* TALLER chips (v0.356.4, founder: "We can make these chips
                taller so they fit the screen") — the map is the whole screen,
                so the destinations grew into the space below instead of
                huddling at the top; each is also a fatter tap target. */}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 8, marginTop: 5 }}>
              {g.items.map((it) => {
                const on = section === it.id;
                return (
                  <Pressable key={it.id} onPress={() => { tap(); setSection(it.id); }}
                    style={{ width: '49%', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 15, justifyContent: 'center', backgroundColor: on ? t.you : t.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: on ? t.you : t.bd }}>
                    {/* deliberately NOT numberOfLines={1}: the track fits the
                        widest label down to a 360dp screen, and below that a
                        wrapped label still says which destination it is where
                        an ellipsis would not. */}
                    <Text style={{ fontFamily: MONO, fontSize: fs(10), fontWeight: '700', color: on ? t.onAccent : t.dim }}>{it.label}</Text>
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
          three ex-SETTINGS slices keep their own sheet (CommishSettings
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
            {section === 'contracts' && native && <ContractRulesCard leagueId={leagueId} />}
            {section === 'format' && native && <FormatCard leagueId={leagueId} />}
            {section === 'players' && native && <CommishPlayers key={`players-${epoch}`} leagueId={leagueId} onChanged={() => void refresh()} />}
            {section === 'dynasty' && native && <DynastyCard leagueId={leagueId} />}
            {section === 'delete' && <DeleteLeagueCard leagueId={leagueId} onDeleted={onBack} />}
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
 *  rows above (chips); this card is everything that moves them together.
 *
 *  Moved here from the SETTINGS sheet: an allowance is something you REVISIT
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
      <Mono size={9} tone="faint" track={0.12}>DRIP COIN — THE WHOLE LEAGUE AT ONCE</Mono>
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
        <Chip label="ALL TEAMS" disabled={busy || !grantWeekDraft || !weeklyInit}
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
          generalized. NOT idempotent, exactly like the per-seat lever. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd, paddingTop: 10, flexWrap: 'wrap' }}>
        <Mono size={9} tone="faint">ONE-OFF</Mono>
        <Chip label="＋" on={bulkSign === 1} onPress={() => { tap(); setBulkSign(1); }} />
        <Chip label="−" on={bulkSign === -1} onPress={() => { tap(); setBulkSign(-1); }} />
        <TextInput value={bulkDraft} keyboardType="number-pad" placeholder="amount"
          placeholderTextColor={t.faint} onChangeText={(v) => setBulkDraft(v.replace(/\D/g, ''))} style={inp(80)} />
        <Chip label={bulkSign === 1 ? 'GRANT ALL' : '− DOCK ALL'} disabled={busy || !bulkDraft}
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
 *  Per-seat balances already existed in the app, but only as a chip on each
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

  // Preseason routing (0253): while a practice week is in play, the balances
  // and grants here are that week's throwaway purse — the note says so.
  const [practiceWeek, setPracticeWeek] = useState<number | null>(null);
  const load = () => adminLeagueMembers(leagueId).then(setSeats).catch((e) => setNote(friendlyError(e)));
  useEffect(() => {
    void load();
    leaguePracticeWeek(leagueId).then(setPracticeWeek).catch(() => setPracticeWeek(null));
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [leagueId]);

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
      <Mono size={9} tone="faint" track={0.12}>DRIP COIN BY TEAM</Mono>
      {practiceWeek != null && (
        <Mono size={9.5} tone="warn" style={{ marginTop: 6, lineHeight: fs(15) }}>
          🏈 PRESEASON — these balances and grants are this practice week's coin. Grants hit the boards now, and the purse wipes when the week ends. Season wallets sit untouched until the preseason is over.
        </Mono>
      )}
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
              Tap a team to grant or dock. Adjustments are additive and immediate, and land on the coin ledger like any other move. DRIP COIN buys power-ups and live buffs — it is NOT the FAAB waiver budget, which has its own wallet under FAAB.
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
    if (!seeded.current) { seeded.current = true; setRookieOnly(isDynastyContinuity(s.continuity)); }
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

  const modeName = st.game_mode === 'classic' ? 'NORMAL' : 'DRIP';
  const rolled = !!st.rolled_league_id;
  const drafted = st.draft_status === 'complete';
  // the Super Bowl gate (0185): the rollover appears when the season is over
  const canRoll = !!st.season_over || !!st.admin;
  const contName = st.continuity === 'contract_dynasty' ? 'CONTRACT DYNASTY'
    : st.continuity === 'contract' ? 'CONTRACT'
    : st.continuity === 'dynasty' ? 'DYNASTY' : st.continuity === 'keeper' ? 'KEEPER' : 'REDRAFT';
  const nameOf = (s: string) => names[s] ?? s;
  const futurePicks = futureSeason == null ? [] : picks.filter((p) => p.season >= futureSeason);

  const doRoll = async () => {
    setBusy(true); setNote(null);
    try {
      const r = await rolloverLeague(leagueId, 14, rookieOnly);
      if (r.ok) {
        commit();
        setNote(`✓ rolled into ${r.season} — a ${r.game_mode === 'classic' ? 'NORMAL' : 'DRIP'} league, ${r.kept} keepers carried, ${r.draft_rounds}-round draft pending. Invite code ${r.invite_code}.`);
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
        <Mono size={9} tone="faint" track={0.12}>NEXT SEASON</Mono>
        <View style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: st.continuity === 'redraft' ? t.bd : t.you, borderRadius: 4, paddingHorizontal: 7, paddingVertical: 2 }}>
          <Text style={{ fontFamily: MONO, fontSize: fs(8.5), fontWeight: '700', letterSpacing: 0.5, color: st.continuity === 'redraft' ? t.dim : t.you }}>{contName}{st.continuity !== 'redraft' ? ' LEAGUE' : ''}</Text>
        </View>
      </View>
      {!!note && <Mono size={9.5} tone={note.startsWith('✓') ? 'you' : 'opp'} style={{ marginTop: 5, lineHeight: fs(14) }}>{note}</Mono>}

      <Mono size={8.5} tone="faint" style={{ marginTop: 8, lineHeight: fs(13) }}>
        {st.continuity === 'redraft'
          ? 'Nothing carries over — switch to keeper or dynasty under MODE.'
          : st.continuity === 'keeper'
            ? `Each team keeps ${st.keeper_count} of ${st.roster_size} into ${st.next_season ?? 'next season'} — change it under MODE. Managers declare keepers on their TEAM screen; a seat that declares nothing keeps its best-ranked.`
            : `${st.rookie_rounds ?? 0}-round rookie drafts; each team keeps ${st.keeper_count} of ${st.roster_size} — change it under MODE. Managers declare keepers on their TEAM screen; a seat that declares nothing keeps its best-ranked.`}
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
                    <Text style={{ fontFamily: MONO, fontSize: fs(9.5), color: t.dim }}>{k.declared ? '' : ''}{nameOf(k.slug)}</Text>
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
                        ’{p.season.slice(2)} R{p.round}{p.orig !== p.owner ? ` ${st.teams.find((x) => x.roster_id === p.orig)?.team ?? `Team ${p.orig}`}` : ''}
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
            <PrimaryButton label={busy ? '…' : `ROLL INTO ${st.next_season ?? '—'} · ${modeName}`} onPress={roll} disabled={busy} />
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
      <LabelInfo label="FAAB WALLETS"
        info={'Grants are additive — a claw-back is a negative, and a balance never drops below $0 (the claim resolver assumes a bid can always be paid).\n\nChanging the waiver mode or the season budget resets every balance to the default.\n\nFAAB buys players; it is NOT drip coin, which buys power-ups. The two never trade against each other.'} />
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
                    This league runs {mode === 'standings' ? 'standings-order' : 'rolling-priority'} waivers, so grants are refused. Switch waivers to FAAB in SETTINGS first — and note that the switch itself resets every balance to the season budget, which is exactly why a grant made now would evaporate.
                  </Mono>
                </Notice>
              </View>
            )}
            {live && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <Mono size={9} tone="faint">EVERY TEAM</Mono>
                <Chip label="GRANT ALL" disabled={busy || teams.length === 0}
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

/** ── CONTRACTS & CAP (0217) ───────────────────────────────────────────────
 *  The commissioner's switch for contract leagues: cap on at $N (auction bids
 *  become salaries, waiver wins sign at their FAAB bid, FA adds at the $1
 *  minimum), max contract length, and the live payroll sheet. Cap off = the
 *  league plays without contracts, exactly as before. */
function ContractRulesCard({ leagueId }: { leagueId: string }) {
  const t = useTheme();
  const [st, setSt] = useState<LeagueContracts | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [capDraft, setCapDraft] = useState('');
  const [yearsDraft, setYearsDraft] = useState(4);
  // the 0219 rulebook, drafted locally and saved in one tap
  const [deadDraft, setDeadDraft] = useState('30');
  const [tagDraft, setTagDraft] = useState('20');
  const [extDraft, setExtDraft] = useState('85');
  const [retention, setRetention] = useState(true);
  const [capTrading, setCapTrading] = useState(false);
  const [irRelief, setIrRelief] = useState(false);
  const [rfa, setRfa] = useState(true);

  const load = () => leagueContracts(leagueId).then((r) => {
    setSt(r);
    if (r.contracts) {
      setCapDraft(String(r.salary_cap ?? '')); setYearsDraft(r.years_max ?? 4);
      if (r.rules) {
        setDeadDraft(String(r.rules.dead_pct)); setTagDraft(String(r.rules.tag_raise_pct));
        setExtDraft(String(r.rules.ext_discount_pct));
        setRetention(r.rules.retention); setCapTrading(r.rules.cap_trading);
        setIrRelief(r.rules.ir_relief); setRfa(r.rules.rfa);
      }
    }
  }).catch((e) => setNote(friendlyError(e)));
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [leagueId]);

  const save = async (cap: number | null) => {
    if (busy) return;
    setBusy(true); setNote(null);
    try {
      const r = await setContractRules(leagueId, cap, cap == null ? null : yearsDraft);
      if (r.ok) { commit(); setNote(cap == null ? '✓ contracts off' : `✓ cap set — $${cap}, deals up to ${yearsDraft}yr`); await load(); }
      else { warn(); setNote(friendlyError(r.error ?? 'that didn’t work')); }
    } catch (e) { warn(); setNote(friendlyError(e)); }
    finally { setBusy(false); }
  };

  const saveRules = async () => {
    if (busy) return;
    setBusy(true); setNote(null);
    try {
      const r = await setSalaryRules(leagueId, {
        deadPct: parseInt(deadDraft, 10), tagRaisePct: parseInt(tagDraft, 10),
        extDiscountPct: parseInt(extDraft, 10),
        retention, capTrading, irRelief, rfa,
      });
      if (r.ok) { commit(); setNote('✓ salary rules saved'); await load(); }
      else { warn(); setNote(friendlyError(r.error ?? 'that didn’t work')); }
    } catch (e) { warn(); setNote(friendlyError(e)); }
    finally { setBusy(false); }
  };

  const on = !!st?.contracts;
  const capNum = parseInt(capDraft, 10);
  const deals = st?.deals ?? [];
  return (
    <Card>
      <LabelInfo label="CONTRACTS & SALARY CAP"
        info={'With the cap on, every acquisition signs a contract:\n\n· an auction win signs at its exact winning bid\n· a waiver win signs at its FAAB bid\n· a free-agent add signs at the $1 minimum\n· startup picks sign at the rookie scale ($12/$6/$3/$1 by round; rookie drafts deal scale contracts at the ROOKIE DEALS term below — default 4yr)\n\nManagers pick each deal\'s length while the draft room is open; after that only you can change one. A move that would land a team over the cap is refused whole.\n\nMulti-year deals carry into next season at a year less; expiring deals walk unless tagged, extended, or matched in RFA.'} />
      {!!note && <Mono size={9.5} tone={note.startsWith('✓') ? 'you' : 'opp'} style={{ marginTop: 5 }}>{note}</Mono>}
      {!st ? <Mono size={10} tone="faint" style={{ marginTop: 8 }}>Loading…</Mono> : (
        <>
          <Mono size={9} tone="dim" style={{ marginTop: 6, lineHeight: fs(13) }}>
            {on ? `ON — $${st.salary_cap} cap · deals up to ${st.years_max}yr · ${deals.length} signed` : 'OFF — this league plays without contracts'}
          </Mono>
          <Mono size={9} tone="faint" style={{ marginTop: 8 }}>SALARY CAP ($)</Mono>
          <TextInput value={capDraft} keyboardType="number-pad" maxLength={6} placeholder="200" placeholderTextColor={t.faint}
            onChangeText={(v) => setCapDraft(v.replace(/[^0-9]/g, ''))}
            style={{ marginTop: 4, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 9, fontSize: fs(14), color: t.text, backgroundColor: t.bg }} />
          <Mono size={9} tone="faint" style={{ marginTop: 8 }}>MAX CONTRACT LENGTH</Mono>
          <View style={{ flexDirection: 'row', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
            {[1, 2, 3, 4, 5, 6].map((y) => (
              <Chip key={y} label={`${y}YR`} on={yearsDraft === y} onPress={() => { tap(); setYearsDraft(y); }} />
            ))}
          </View>
          <View style={{ marginTop: 10, gap: 8 }}>
            <PrimaryButton label={busy ? '…' : on ? '✓ UPDATE CAP & LENGTH' : 'TURN CONTRACTS ON'}
              disabled={busy || !Number.isFinite(capNum) || capNum < 1}
              onPress={() => void save(capNum)} />
            {on && <LinkButton label="✕ TURN CONTRACTS OFF" onPress={() => void save(null)} />}
          </View>
          {/* ── THE RULEBOOK (0219/0220): every salary option in one place ── */}
          {on && (
            <View style={{ marginTop: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd, paddingTop: 10 }}>
              <LabelInfo label="SALARY RULES"
                info={'DEAD MONEY % — cut a multi-year deal and this share of it stays on your books for the deal\'s remaining life. 0 turns the penalty off.\n\nTAG RAISE % — the franchise tag (one per team, offseason) re-signs an expiring deal for one year at whichever is higher: the top-5 positional market average, or last salary plus this raise.\n\nEXT. DISCOUNT % — offseason extensions re-sign expiring deals for 1–3 years at this share of the league\'s own market value.\n\nRETENTION — a trader may keep eating part of a traded salary ($1 up to salary−1); the ghost stays on their cap for the deal\'s life.\n\nCAP TRADING — raw cap dollars move in trades like a pick. Many leagues ban this; it defaults off.\n\nIR RELIEF — an IR\'d player\'s salary comes off the books until he\'s activated.\n\nRFA — owners may tender expiring players to the market: rivals bid salary and years, and the owner matches or lets him walk with the re-priced deal.'} />
              <View style={{ flexDirection: 'row', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
                {([['DEAD MONEY %', deadDraft, setDeadDraft, 'cut a multi-year deal, eat this % of it'],
                   ['TAG RAISE %', tagDraft, setTagDraft, 'franchise tag floor over last salary'],
                   ['EXT. DISCOUNT %', extDraft, setExtDraft, 'extensions sign at this % of market']] as const
                ).map(([lbl, val, set]) => (
                  <View key={lbl} style={{ minWidth: 96 }}>
                    <Mono size={8} tone="faint">{lbl}</Mono>
                    <TextInput value={val} keyboardType="number-pad" maxLength={3}
                      onChangeText={(v) => set(v.replace(/[^0-9]/g, ''))}
                      style={{ marginTop: 3, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 6, fontSize: fs(13), color: t.text, backgroundColor: t.bg, width: 72 }} />
                  </View>
                ))}
              </View>
              {/* 0231: the rookie term applies on its own tap — it is one number,
                  not part of the drafted rulebook batch */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 10, flexWrap: 'wrap' }}>
                <LabelInfo label="ROOKIE DEALS" title="Rookie contract length"
                  info={'Every rookie-draft pick signs a scale contract ($12/$6/$3/$1 by round) for this many years — default 4, the NFL\u2019s own rookie term. Managers never set rookie lengths; the scale does.\n\nClamped to the league\u2019s max contract length. Applies to picks made after the change.'} />
                {Array.from({ length: st.years_max ?? 4 }, (_, i) => i + 1).map((y) => (
                  <Chip key={y} label={`${y}YR`} on={(st.rules?.rookie_years ?? 4) === y} disabled={busy}
                    onPress={() => {
                      tap();
                      void setRookieYears(leagueId, y).then((r) => {
                        if (r.ok) { commit(); setNote(`✓ rookie deals sign for ${y}yr`); void load(); }
                        else { warn(); setNote(friendlyError(r.error ?? 'that didn’t work')); }
                      }).catch((e) => { warn(); setNote(friendlyError(e)); });
                    }} />
                ))}
              </View>
              <View style={{ flexDirection: 'row', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                <Chip label="RETENTION" on={retention} onPress={() => { tap(); setRetention((v) => !v); }} />
                <Chip label="CAP TRADING" on={capTrading} onPress={() => { tap(); setCapTrading((v) => !v); }} />
                <Chip label="IR RELIEF" on={irRelief} onPress={() => { tap(); setIrRelief((v) => !v); }} />
                <Chip label="RFA" on={rfa} onPress={() => { tap(); setRfa((v) => !v); }} />
              </View>
              <View style={{ marginTop: 8 }}>
                <PrimaryButton label={busy ? '…' : '✓ SAVE SALARY RULES'} disabled={busy} onPress={() => void saveRules()} />
              </View>
            </View>
          )}
          {on && (st.payrolls ?? []).length > 0 && (
            <View style={{ marginTop: 12, gap: 1 }}>
              <Mono size={9} tone="faint" track={0.12}>PAYROLLS</Mono>
              {(st.payrolls ?? []).map((p) => {
                const cap = p.cap ?? st.salary_cap ?? 0;
                const room = cap - p.payroll;
                return (
                  <View key={p.roster_id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 7, paddingHorizontal: 8, backgroundColor: t.bg, borderRadius: 3, marginTop: 4 }}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text numberOfLines={1} style={{ fontSize: fs(13), fontWeight: '600', color: t.text }}>{p.team || `Roster ${p.roster_id}`}</Text>
                      {!!p.cap_adjust && <Mono size={8} tone="faint">cap {p.cap_adjust > 0 ? '+' : ''}${p.cap_adjust} by trade</Mono>}
                    </View>
                    <Text style={{ fontFamily: MONO, fontSize: fs(12), fontWeight: '700', color: room < 0 ? t.opp : t.text }}>${p.payroll} / ${cap}</Text>
                    <Mono size={8.5} tone={room < 0 ? 'opp' : 'faint'}>{room < 0 ? `$${-room} OVER` : `$${room} room`}</Mono>
                  </View>
                );
              })}
            </View>
          )}
        </>
      )}
    </Card>
  );
}

/** ── FORMAT (0221/0222) ───────────────────────────────────────────────────
 *  How the season is WON: head-to-head, guillotine (weekly elimination +
 *  frenzy — pre-draft only, the server enforces it), or vampire (a seat
 *  that steals on wins). The vampire's controls live here too: appoint the
 *  seat and flip steal review (the founder's "commish can option to approve
 *  risky moves"). Pending steal rulings surface on the card in Standings. */
function FormatCard({ leagueId }: { leagueId: string }) {
  const t = useTheme();
  const [fmt, setFmt] = useState<LeagueFormat | null>(null);
  const [vamp, setVamp] = useState<VampireState | null>(null);
  const [seats, setSeats] = useState<AdminMember[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = () => Promise.all([
    guillotineState(leagueId).then((g) => {
      if (g.guillotine) { setFmt('guillotine'); return null; }
      return vampireState(leagueId).then((v) => { setVamp(v.vampire ? v : null); setFmt(v.vampire ? 'vampire' : 'standard'); });
    }),
    adminLeagueMembers(leagueId).then((m) => { if (Array.isArray(m)) setSeats(m); }).catch(() => {}),
  ]).catch(() => setFmt('standard'));
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [leagueId]);

  const act = async (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => {
    if (busy) return;
    setBusy(true); setNote(null);
    try {
      const r = await fn();
      if (r.ok) { commit(); setNote(done); await load(); }
      else { warn(); setNote(friendlyError(r.error ?? 'that didn’t work')); }
    } catch (e) { warn(); setNote(friendlyError(e)); }
    finally { setBusy(false); }
  };

  if (fmt == null) return <Card><Mono size={10} tone="faint">Loading…</Mono></Card>;
  return (
    <Card>
      <LabelInfo label="LEAGUE FORMAT"
        info={'How the season is WON.\n\nHEAD-TO-HEAD — the standard game: weekly matchups, standings, playoffs.\n\nGUILLOTINE — each week the lowest-scoring surviving team is eliminated and its whole roster is released to a FAAB frenzy; the last team standing wins. Pick it BEFORE the draft (it changes how the season scores); it presets FAAB waivers with a $1000 budget. Bring extra teams — one falls per week.\n\nVAMPIRE — vampire seats DON\'T DRAFT: appointed before the draft, they sit it out and build their roster from what everyone left in the pool. A vampire that wins its matchup steals a player from the loser\'s active roster, giving one back. Optionally lock the wire so only vampires can make pickups.'} />
      {!!note && <Mono size={9.5} tone={note.startsWith('✓') ? 'you' : 'opp'} style={{ marginTop: 5 }}>{note}</Mono>}
      <View style={{ flexDirection: 'row', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
        <Chip label="HEAD-TO-HEAD" on={fmt === 'standard'} disabled={busy}
          onPress={() => void act(() => setLeagueFormat(leagueId, 'standard'), '✓ head-to-head')} />
        <Chip label="GUILLOTINE" on={fmt === 'guillotine'} disabled={busy}
          onPress={() => void act(() => setLeagueFormat(leagueId, 'guillotine'), '✓ guillotine — $1000 FAAB market preset')} />
        <Chip label="VAMPIRE" on={fmt === 'vampire'} disabled={busy}
          onPress={() => void act(() => setLeagueFormat(leagueId, 'vampire'), '✓ vampire — now appoint the seat below')} />
      </View>
      {fmt === 'vampire' && (
        <View style={{ marginTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd, paddingTop: 8 }}>
          <LabelInfo label="THE COVEN"
            info={'Tap teams in and out of the coven — a league can run any number of vampires (at least one team must remain to draft). Appoint them BEFORE the draft: vampire seats sit the draft out and build their rosters from the leftover pool. A vampire appointed after the draft keeps what it drafted.\n\nWIRE LOCK: with the wire locked, only vampires can sign free agents or claim waivers — the pool is their hunting ground, and beaten teams can\'t restock around their losses.\n\nSTEAL APPROVAL is your hand on it: with approval on, each declared steal parks as PENDING and you approve or veto it from the card in the Standings sheet. Either ruling prints in the league register.'} />
          {/* the coven: toggle chips — each tap re-appoints the whole set */}
          <View style={{ flexDirection: 'row', gap: 5, marginTop: 6, flexWrap: 'wrap' }}>
            {seats.map((m) => {
              const inCoven = (vamp?.seats ?? (vamp?.seat != null ? [vamp.seat] : [])).includes(m.roster_id);
              return (
                <Chip key={m.roster_id} label={`${inCoven ? '🧛 ' : ''}${m.team ?? `Team ${m.roster_id}`}`} on={inCoven} disabled={busy}
                  onPress={() => {
                    const cur = vamp?.seats ?? (vamp?.seat != null ? [vamp.seat] : []);
                    const next = inCoven ? cur.filter((s) => s !== m.roster_id) : [...cur, m.roster_id];
                    void act(() => setVampires(leagueId, next),
                      inCoven ? `✓ ${m.team ?? `team ${m.roster_id}`} is mortal again` : `✓ ${m.team ?? `team ${m.roster_id}`} joins the coven`);
                  }} />
              );
            })}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <Chip label={vamp?.steal_review ? 'STEALS NEED YOUR APPROVAL' : 'STEALS EXECUTE INSTANTLY'} on={!!vamp?.steal_review}
              disabled={busy || (vamp?.seats ?? []).length === 0}
              onPress={() => { const cur = vamp?.seats ?? []; if (cur.length) void act(() => setVampires(leagueId, cur, !vamp?.steal_review, null), vamp?.steal_review ? '✓ steals execute instantly' : '✓ steals await your ruling'); }} />
            <Chip label={vamp?.wire_lock ? '🔒 WIRE LOCKED TO THE COVEN' : 'WIRE OPEN TO EVERYONE'} on={!!vamp?.wire_lock}
              disabled={busy || (vamp?.seats ?? []).length === 0}
              onPress={() => { const cur = vamp?.seats ?? []; if (cur.length) void act(() => setVampires(leagueId, cur, null, !vamp?.wire_lock), vamp?.wire_lock ? '✓ the wire is open to everyone' : '✓ only the coven works the wire now'); }} />
          </View>
        </View>
      )}
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
  // 0208's door. Unknown until toggled — the league row this screen has does
  // not carry the flag, and guessing 'open' would mislabel a closed league.
  const [waitlistOpen, setWaitlistOpen] = useState<boolean | null>(null);
  const [waitlistNote, setWaitlistNote] = useState<string | null>(null);
  const flipWaitlist = async () => {
    tap();
    const next = waitlistOpen === false;   // closed → reopen, else close
    try {
      const r = await setLeagueWaitlist(leagueId, next);
      if (!r.ok) { warn(); setWaitlistNote(friendlyError(r.error ?? 'could not change that')); return; }
      commit();
      setWaitlistOpen(!!r.waitlist_open);
      setWaitlistNote(r.waitlist_open
        ? 'Open — a full league queues new joiners for you.'
        : `Closed. New joiners see “League Full”.${r.waiting ? ` The ${r.waiting} already waiting are still here.` : ''}`);
    } catch (e) { warn(); setWaitlistNote(friendlyError(e)); }
  };
  const [mgrFor, setMgrFor] = useState<AdminMember | null>(null);     // add-co-manager target
  const [mgrDraft, setMgrDraft] = useState('');
  const [renameFor, setRenameFor] = useState<AdminMember | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  // Division assignment (0215): a per-seat label; blank clears it. Divisions
  // activate once every seat is labeled and at least two labels exist.
  const [divFor, setDivFor] = useState<AdminMember | null>(null);
  const [divDraft, setDivDraft] = useState('');
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
      <Mono size={9} tone="faint" track={0.12}>TEAMS — ASSIGN, UNASSIGN, KICK</Mono>
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
                    () => setNote(`✓ ${m.team ?? `roster ${m.roster_id}`} → ${m.controller === 'ai' ? 'human' : 'AI'} control`)); }} />
                {/* the balance IS the button label — you see what you're about
                    to move, and it re-reads with the seats after every act() */}
                <Chip label={`${coinFmt(m.coin)}`} onPress={() => { tap(); setCoinFor(m); setCoinDraft(''); setCoinSign(1); }} />
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
              {/* the label doubles as the current value — the map is readable
                  from the row you edit it on */}
              <Chip label={m.division ? `⌸ ${m.division.toUpperCase()}` : '⌸ DIVISION'} on={!!m.division}
                onPress={() => { tap(); setDivFor(m); setDivDraft(m.division ?? ''); }} />
            </View>
            {seatMgrs.map((g) => (
              <View key={g.app_user_id} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3, paddingLeft: 12 }}>
                <Mono size={8.5} tone="dim" style={{ flex: 1 }}>{g.email ?? g.app_user_id.slice(0, 8)}</Mono>
                <LinkButton label="remove" tone="opp" onPress={() => void act(
                  () => commishSetManager(leagueId, m.roster_id, { appUserId: g.app_user_id, remove: true }),
                  () => setNote('✓ co-manager removed'))} />
              </View>
            ))}
          </View>
        );
      })}

      {/* THE DOOR ON THE WAITING ROOM (v0.326.0, founder: "can we have a commish
          option to close the waiting room. Just 'League Full'"). Rendered even
          with nobody queued, because closing it is something you do BEFORE the
          queue forms — a control that only appears once people are waiting is a
          control you find too late. See the web board for the full note; in
          short it does not close the league (a free seat still seats the next
          arrival) and it does not evict anyone already waiting. */}
      <View style={{ marginTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd, paddingTop: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Mono size={9} tone="faint" track={0.12}>WAITING ROOM</Mono>
          <Mono size={9.5} weight="700" tone={waitlistOpen === false ? 'warn' : 'you'}>
            {waitlistOpen === null ? '—' : waitlistOpen ? 'OPEN' : 'CLOSED · “League Full”'}
          </Mono>
          <Chip label={waitlistOpen === false ? 'REOPEN' : 'CLOSE'} onPress={flipWaitlist} />
        </View>
        {!!waitlistNote && <Mono size={8.5} tone="faint" style={{ marginTop: 5, lineHeight: fs(13) }}>{waitlistNote}</Mono>}
      </View>

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
          <PrimaryButton label={busy ? '…' : coinSign === 1 ? 'GRANT' : '− DOCK'} disabled={busy || !coinDraft}
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

      {/* division label, any seat (0215). Blank SAVES AS A CLEAR — the same
          control draws the map and erases it, and the button says which. */}
      <Overlay visible={!!divFor} title={divFor ? `Division for ${divFor.team ?? `roster ${divFor.roster_id}`}` : ''}
        subtitle="Same label = same division. Divisions turn on once every team has one and at least two labels exist — winners take the top playoff seeds, and rematch weeks become rivalry weeks." onClose={() => setDivFor(null)}>
        <TextInput value={divDraft} autoFocus maxLength={24} placeholder="East" placeholderTextColor={t.faint} onChangeText={setDivDraft}
          style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 9, fontSize: fs(14), color: t.text, backgroundColor: t.bg }} />
        <View style={{ marginTop: 10 }}>
          <PrimaryButton label={busy ? '…' : divDraft.trim() ? '✓ SET DIVISION' : '✕ CLEAR DIVISION'} disabled={busy}
            onPress={() => {
              const m = divFor; setDivFor(null);
              if (m) void act(() => setTeamDivision(leagueId, m.roster_id, divDraft.trim() || null),
                () => setNote(divDraft.trim() ? `✓ ${m.team ?? `roster ${m.roster_id}`} → ${divDraft.trim()}` : '✓ division cleared'));
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
// Normie mode (0157): DRIP CLASSIC + the PPR knob while classic. The server
// freezes the mode once the draft starts; its refusal shows inline. CLASSIC
// only offers itself where the founder's per-league flag (0158) is on.
// A builder spot's local draft row: pos/bb plus the PER-SLOT player filter
// (0172) as raw input strings, so partial typing never fights the keyboard.
// `k` is a client-only stable key: drag-to-reorder (v0.267.0) needs row views
// that SURVIVE a reorder — index keys would remount the row mid-gesture and
// kill the pan responder. Never sent to the server (fromSpotDraft ignores it).
type SpotDraft = { k: number; pos: string[]; bb?: boolean; label: string; fTeams: string; fMin: string; fMax: string; fFlags: string[]; zero: string };
let spotKeySeq = 1;
const toSpotDraft = (x: SlotSpec): SpotDraft => ({
  k: spotKeySeq++,
  pos: [...x.pos], bb: !!x.bb, label: x.label ?? '',
  fTeams: (x.teams ?? []).join(', '),
  fMin: x.min_exp != null ? String(x.min_exp) : '',
  fMax: x.max_exp != null ? String(x.max_exp) : '',
  fFlags: [...(x.flags ?? [])],
  zero: x.zero_pts != null ? String(x.zero_pts) : '',
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
    // FLAGS (v0.301.0) — the app collected them and never sent them; the web
    // twin has carried them since the day they landed.
    ...(s.fFlags.length ? { flags: s.fFlags } : {}),
    // The zero-fill rule (0200). Never sent on a best-ball spot — the server
    // refuses the pair, and the control below can't produce it either.
    ...(!s.bb && s.zero.trim() !== '' && Number.isFinite(Number(s.zero)) ? { zero_pts: Number(s.zero) } : {}),
  };
};
const spotHasFlt = (s: SpotDraft) => !!(s.fTeams.trim() || s.fMin.trim() || s.fMax.trim() || s.fFlags.length || s.zero.trim());

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
// ── Continuity (0185): REDRAFT / KEEPER / DYNASTY, in MODE ────────────────
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
    setN(m === 'keeper' ? String(s.keeper_count) : isDynastyContinuity(m) ? String(s.rookie_rounds ?? 3) : '');
  };
  useEffect(() => { void load().catch(() => {}); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [leagueId]);
  if (!st) return null;

  const rolled = !!st.rolled_league_id;
  const pick = (m: LeagueContinuity) => {
    if (busy || rolled) return;
    tap(); setCmode(m); setNote(null);
    setN(m === 'keeper' ? String(st.keeper_count || Math.min(4, st.roster_size - 1))
       : isDynastyContinuity(m) ? String(st.rookie_rounds || 3) : '');
  };
  const needsN = cmode === 'keeper' || isDynastyContinuity(cmode);
  const save = async () => {
    if (busy || rolled) return;
    const num = parseInt(n, 10);
    if (needsN && Number.isNaN(num)) return;
    setBusy(true); setNote(null);
    try {
      const r = await setLeagueContinuity(leagueId, cmode, needsN ? num : null);
      if (r.ok) { commit(); setNote('✓ saved'); await load(); }
      else { warn(); setNote(friendlyError(r.error ?? 'that didn’t work')); }
    } catch (e) { warn(); setNote(friendlyError(e)); }
    finally { setBusy(false); }
  };

  return (
    <View style={{ marginTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd, paddingTop: 10 }}>
      <LabelInfo label="NEXT SEASON · CONTINUITY"
        info={'What carries into next season:\n\nREDRAFT — every season starts fresh. Full draft, nothing carries over.\n\nKEEPER — each team carries that many players into next season and redrafts the rest. Managers declare keepers on their TEAM screen; undeclared seats keep their best-ranked.\n\nDYNASTY — teams keep everyone except the rookie-draft spots and draft rookies each year. Every team\'s picks for the NEXT THREE SEASONS are dealt as tradeable assets — see them in NEXT SEASON.\n\nCONTRACT — a salary-cap league: auction bids become salaries and the cap turns on at the auction budget. Tune it under MONEY → SALARY.\n\nCONTRACT DYNASTY — contracts AND dynasty: bids become salaries, rookies sign 3-year scale deals, plus the rookie rounds and the pick horizon.\n\nSwitching to a plain type turns contracts off — the selector owns contract-ness.'} />
      <View style={{ flexDirection: 'row', gap: 5, marginTop: 7, flexWrap: 'wrap', alignItems: 'center' }}>
        <Chip on={cmode === 'redraft'} label="REDRAFT" disabled={busy || rolled} onPress={() => pick('redraft')} />
        <Chip on={cmode === 'keeper'} label="KEEPER" disabled={busy || rolled} onPress={() => pick('keeper')} />
        <Chip on={cmode === 'dynasty'} label="DYNASTY" disabled={busy || rolled} onPress={() => pick('dynasty')} />
        <Chip on={cmode === 'contract'} label="CONTRACT" disabled={busy || rolled} onPress={() => pick('contract')} />
        <Chip on={cmode === 'contract_dynasty'} label="CONTRACT DYNASTY" disabled={busy || rolled} onPress={() => pick('contract_dynasty')} />
        {needsN && (
          <TextInput value={n} onChangeText={(v) => setN(v.replace(/\D/g, ''))} keyboardType="number-pad"
            editable={!busy && !rolled}
            style={{ fontFamily: MONO, fontSize: fs(12), color: t.text, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 5, paddingHorizontal: 9, paddingVertical: 5, minWidth: 42, textAlign: 'center' }} />
        )}
        {needsN && (
          <Mono size={9} tone="faint">{cmode === 'keeper' ? `keepers of ${st.roster_size}` : 'rookie rounds'}</Mono>
        )}
        <Pressable disabled={busy || rolled} onPress={() => { tap(); void save(); }}
          style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 5, paddingHorizontal: 10, paddingVertical: 6, opacity: busy || rolled ? 0.5 : 1 }}>
          <Text style={{ fontFamily: MONO, fontSize: fs(10), fontWeight: '700', color: t.dim }}>SAVE</Text>
        </Pressable>
      </View>
      {/* only STATE prints inline now — the five-way explainer lives in the ⓘ */}
      {rolled && (
        <Mono size={8} tone="faint" style={{ marginTop: 5 }}>
          This season already rolled over — continuity is set on the new league.
        </Mono>
      )}
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
  // GOLF (v0.303.0): null until the mode load lands, so neither pill lights up
  // on a guess.
  const [golf, setGolf] = useState<boolean | null>(null);
  const saveGolf = async (on: boolean) => {
    if (busy) return;
    setBusy(true); setNote(null);
    try {
      const r = await setLeagueGolf(leagueId, on);
      if (r.ok) { commit(); setGolf(r.golf === true); setNote(on ? '✓ golf mode on — lowest wins' : '✓ golf mode off'); }
      else { warn(); setNote(r.error ?? 'failed'); }
    } finally { setBusy(false); }
  };
  // The roster POSITION BUILDER (0163): draft rows, one SAVE writes the spec.
  const [spots, setSpots] = useState<SpotDraft[] | null>(null);
  const [spotsDirty, setSpotsDirty] = useState(false);
  const [presetPick, setPresetPick] = useState(false);
  // The review-before-save sheet (v0.351.0, founder: "a confirmation that
  // details all the roster decisions and rules and asks for confirmation or
  // go back") — SAVE LINEUP opens it; only ✓ CONFIRM actually writes.
  const [reviewOpen, setReviewOpen] = useState(false);
  // The league's flag vocabulary (v0.300.0) — the labels a spot filter may
  // require. Empty in a league that has flagged nobody, and the row hides.
  const [flagLabels, setFlagLabels] = useState<string[]>([]);
  useEffect(() => {
    playerFlags(leagueId).then((rows) => {
      if (Array.isArray(rows)) setFlagLabels([...new Set(rows.map((r) => (r.label ?? '').trim()).filter(Boolean))].sort());
    }).catch(() => {});
  }, [leagueId]);
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
  // The draft's own window (0064, widened to 99 in 0192). Roster size IS the
  // round count, so this bounds starters + bench + taxi + IR.
  const MAX_ROUNDS = 99;
  // THE TAXI SQUAD'S OWN RULES (0196): who may ride it, and whether it shuts at
  // the season's first kickoff. Beside the SIZE, which is the number above it.
  const [taxi, setTaxi] = useState<{ maxExp: number | null; lock: boolean; lockedNow: boolean } | null>(null);
  // WHO MAY GO ON IR (0198): the commissioner's own list of designations, off
  // the same call. Default is IR/O — the pair 0164 hardcoded.
  const [irTags, setIrTags] = useState<string[] | null>(null);
  const loadTaxi = () => {
    rosterRules(leagueId).then((r) => {
      if (!r.ok) return;
      setTaxi({ maxExp: r.taxi_max_exp ?? null, lock: r.taxi_lock !== false, lockedNow: !!r.taxi_locked_now });
      setIrTags(r.ir_tags?.length ? r.ir_tags : ['IR', 'O']);
    }).catch(() => {});
  };
  useEffect(loadTaxi, [leagueId]);
  const saveTaxi = async (maxExp: number | null, lock: boolean | null) => {
    if (busy) return;
    setBusy(true); setNote(null);
    try {
      const r = await setTaxiRules(leagueId, maxExp, lock);
      if (r.ok) { commit(); setTaxi({ maxExp: r.max_exp ?? null, lock: r.lock !== false, lockedNow: !!r.locked_now }); setNote('✓ taxi rules saved'); }
      else { warn(); setNote(r.error ?? 'failed'); }
    } finally { setBusy(false); }
  };
  /** Toggle one designation in or out of the IR list. The server refuses an
   *  empty list, so the last one standing says why rather than bouncing. */
  const saveIrTag = async (tag: string) => {
    if (busy || !irTags) return;
    const on = irTags.includes(tag);
    if (on && irTags.length === 1) { warn(); setNote('IR needs at least one designation.'); return; }
    setBusy(true); setNote(null);
    try {
      const next = on ? irTags.filter((x) => x !== tag) : [...irTags, tag];
      const r = await setIrRules(leagueId, next);
      if (r.ok) { commit(); setIrTags(r.tags?.length ? r.tags : next); setNote('✓ IR eligibility saved'); }
      else { warn(); setNote(r.error ?? 'failed'); }
    } finally { setBusy(false); }
  };
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
      setMode(r.mode ?? 'drip'); setPpr(Number(r.ppr ?? 1)); setClassicOk(r.classic_ok === true); setGolf(r.golf === true); scInit(r.scoring ?? {});
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
          <LabelInfo label="GAME MODE"
            info={'DRIP is the full game: your 8 starters play head-to-head in real time as the games run — drips, nukes and power-ups on live play-by-play.\n\nCLASSIC is traditional fantasy — standard scoring, one weekly QB/RB/RB/WR/WR/TE/FLEX/K/DEF lineup, no bonuses or power-ups.\n\nThe mode locks once the draft starts: it decides what the league drafts FOR, so it can\'t be a decide-later.'} />
        </View>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          <Pill on={mode === 'drip'} label="DRIP" onPress={() => void set('drip')} />
          {(classicOk || mode === 'classic')
            ? <Pill on={mode === 'classic'} label="CLASSIC" onPress={() => void set('classic')} />
            : <Mono size={8} tone="faint" style={{ alignSelf: 'center' }}>CLASSIC{'\n'}not unlocked</Mono>}
        </View>
      </View>
      {/* ── GOLF MODE (v0.303.0) ──────────────────────────────────────────
          One setting that inverts who wins. It sits beside GAME MODE because
          it changes no scoring value at all — a touchdown is worth what the
          catalog says — it changes which end of the leaderboard you aim at,
          which is a fact about the GAME. Frozen at the draft for the same
          reason the mode is: you draft a golf league inside out. */}
      {mode === 'classic' && (
        <View style={{ marginTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd, paddingTop: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <LabelInfo label="⛳ GOLF MODE"
                info={'The LOWEST weekly total wins — standings, tiebreaks and playoffs all read the other way.\n\nScoring itself is untouched: a touchdown is still worth what the catalog says. Golf changes which end of the leaderboard you aim at, and pairs with the ⛳ zero-fill on each starting spot (an empty spot scores 0, which in golf is perfect).\n\nLocks at the draft — you draft a golf league inside out.'} />
            </View>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              <Pill on={golf === false} label="HIGH" onPress={() => void saveGolf(false)} />
              <Pill on={golf === true} label="⛳ LOW" onPress={() => void saveGolf(true)} />
            </View>
          </View>
        </View>
      )}
      {/* K/DST FILL (v0.225.0) — a setup decision about what the league
          rosters, so it sits with the game mode exactly as it does on web.
          PORTED DELIBERATELY PARTIALLY: the mode selector is the part that
          decides league behaviour and belongs on a phone; MANUAL's per-team
          assignment is a 32-option dropdown per seat, which is a desk job, so
          it points at the web console rather than pretending to fit. */}
      {kdst && (
        <View style={{ marginTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd, paddingTop: 10 }}>
          <LabelInfo label="K / D-ST FILL"
            info={'When a league doesn\'t roster kickers or defenses, filling them keeps the Banker / Suppress metrics playable.\n\nRANDOM WEEKLY deals every team a not-on-bye K and D-ST each week. MANUAL lets each team be assigned specific ones (the per-team picker is on the web console). Changes take effect on the next sync.'} />
          {/* the STATUS stays inline — state is not explanation */}
          <Mono size={8.5} tone={kdst.needs_k || kdst.needs_def ? 'dim' : 'faint'} style={{ marginTop: 4 }}>
            {kdst.needs_k || kdst.needs_def
              ? `no ${[kdst.needs_k && 'kickers', kdst.needs_def && 'defenses'].filter(Boolean).join(' or ')} rostered here`
              : 'this league rosters both K and DEF — no fill needed'}
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
          season"); NEXT SEASON shows the consequences. */}
      <ContinuityRow leagueId={leagueId} />
      </>)}
      {view === 'lineup' && mode !== 'classic' && mode !== null && (
        <Mono size={8.5} tone="faint" style={{ lineHeight: fs(12) }}>
          A DRIP league has no lineup builder — everyone fields 8 weekly starters, any position. Roster size and position caps live on the web console's ROSTER tab.
        </Mono>
      )}
      {view === 'scoring' && mode !== 'classic' && mode !== null && (
        <Mono size={8.5} tone="faint" style={{ lineHeight: fs(12) }}>
          DRIP scoring is the metric catalog — it has no per-stat values to tune here. Switch the league to CLASSIC under MODE for the full scoring editor.
        </Mono>
      )}
      {view === 'lineup' && mode === 'classic' && spots && (() => {
        // starters + the three stashes: what the draft's rounds will be.
        const shapeTotal = spots.length + shape.bench + shape.taxi + shape.ir;
        return (
        <View>
          {/* Roster POSITION BUILDER (0163, the founder's sketch): a row per
              starting spot — its own eligible positions + best-ball flag. */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Mono size={8.5} tone="faint" weight="700">ROSTER BUILDER · {spots.length} STARTING SPOTS</Mono>
            {spotsDirty && <Pill on label="SAVE LINEUP" onPress={() => setReviewOpen(true)} />}
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
                    onPress={() => { tap(); setSpots((cur) => cur!.map((x, j) => j !== i ? x : { ...x, bb: !x.bb, zero: x.bb ? x.zero : '' })); setSpotsDirty(true); }}
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
            <Pill on={false} label="＋ ADD SPOT" onPress={() => { if (spots.length < 20) { setSpots((cur) => [...cur!, { k: spotKeySeq++, pos: ['RB', 'WR', 'TE'], label: '', fTeams: '', fMin: '', fMax: '', fFlags: [], zero: '' }]); setSpotsDirty(true); } }} />
            <Mono size={7.5} tone="faint">⠿ drag to reorder · best-ball fills itself · ✏️ name the spot + limit who fills it</Mono>
          </View>
          {/* PRE-BAKED SPOTS (v0.351.0): one tap, fully configured. */}
          <View style={{ marginTop: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Mono size={8} tone="faint" weight="700" track={0.1}>PRESET SPOTS</Mono>
              <InfoChip title="Preset spots">
                {'One tap adds a fully-configured spot:\n\nROOKIE SFLX / FLEX — best-ball spots only a rookie (0 years experience) may fill.\n\nBB KICKER / D/ST — best-ball K and D/ST: the spot picks its own best scorer each week.\n\nNFC / AFC SFLX — a superflex only that conference\'s players may fill.\n\nVET 8+ — spots reserved for players with 8+ years of NFL experience.\n\nEvery preset is editable after adding (✏️) — they are ordinary spots, just pre-assembled. Tenure- and conference-limited spots need the pool seeded with experience data (re-seed if tenure shows blank).'}
              </InfoChip>
            </View>
            {/* A PICKER, NOT EIGHT CHIPS (founder: "let's make the preset
                slots a drop down or card so it doesn't take up so much
                room"). Eight pre-baked spots wrapped to three rows inside an
                editor that already runs long, and the list only grows. One
                button opens them over the page, where each one has the room
                to say what it actually is rather than shouting an
                abbreviation. */}
            <View style={{ flexDirection: 'row', gap: 5, marginTop: 5, alignItems: 'center' }}>
              <Pill on={false} label="ADD A PRESET SPOT" onPress={() => { tap(); setPresetPick(true); }} />
              <Mono size={8.5} tone="faint">{SPOT_PRESETS.length} available</Mono>
            </View>
            <Overlay visible={presetPick} title="Preset spots" onClose={() => setPresetPick(false)}>
              <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 28, gap: 8 }}>
                {SPOT_PRESETS.map((pr) => (
                  <Pressable key={`ps-${pr.chip}`} disabled={spots.length >= 20}
                    onPress={() => {
                      if (spots.length >= 20) return;
                      tap(); setPresetPick(false);
                      setSpots((cur) => [...cur!, { k: spotKeySeq++, pos: [...pr.pos], bb: pr.bb, label: pr.label, fTeams: pr.fTeams ?? '', fMin: pr.fMin ?? '', fMax: pr.fMax ?? '', fFlags: [], zero: '' }]);
                      setSpotsDirty(true);
                    }}
                    style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 8, padding: 12, opacity: spots.length >= 20 ? 0.45 : 1 }}>
                    <Text style={{ fontSize: 14, fontWeight: '700', color: t.text }}>{pr.label}</Text>
                    <Mono size={9.5} tone="faint" style={{ marginTop: 3 }}>
                      {pr.pos.join(' / ')}{pr.bb ? ' · best ball' : ''}
                      {pr.fMax === '0' ? ' · rookies only' : ''}
                      {pr.fMin ? ` · ${pr.fMin}+ years` : ''}
                      {pr.fTeams ? ' · conference-limited' : ''}
                    </Mono>
                  </Pressable>
                ))}
                {spots.length >= 20 && (
                  <Mono size={9.5} tone="warn" style={{ lineHeight: 14 }}>20 spots is the ceiling — remove one to add a preset.</Mono>
                )}
              </ScrollView>
            </Overlay>
          </View>

          {/* ── REVIEW & CONFIRM (v0.351.0) ─────────────────────────────────
              Every roster decision, read back in full before it's written:
              each spot with its eligibility, best-ball flag, filters and
              zero-fill; then the bench/taxi/IR shape. ✓ CONFIRM saves;
              ← GO BACK returns to the builder untouched. */}
          <Overlay visible={reviewOpen} title="Review the roster"
            subtitle="This is exactly what the league will play with. Confirm, or go back and adjust."
            onClose={() => setReviewOpen(false)}>
            <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ padding: 14, paddingBottom: 24 }}>
              <Mono size={9} tone="faint" weight="700" track={0.12}>STARTING SPOTS ({spots.length})</Mono>
              {spots.map((sp, i) => {
                const rules: string[] = [];
                if (sp.bb) rules.push('best-ball — fills itself');
                if (sp.fMax === '0') rules.push('rookies only');
                else {
                  if (sp.fMin) rules.push(`${sp.fMin}+ yrs experience`);
                  if (sp.fMax && sp.fMax !== '0') rules.push(`≤${sp.fMax} yrs experience`);
                }
                if (sp.fTeams.trim()) rules.push(`teams: ${sp.fTeams.trim()}`);
                if (sp.fFlags.length) rules.push(`${sp.fFlags.join(', ')} only`);
                if (sp.zero.trim()) rules.push(`⛳ zero-fill ${sp.zero.trim()}pts`);
                return (
                  <View key={sp.k} style={{ paddingVertical: 5, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd }}>
                    <Text style={{ fontSize: fs(12.5), fontWeight: '700', color: t.text }}>
                      {i + 1}. {sp.label.trim() || sp.pos.join('/')}
                      {sp.label.trim() ? <Text style={{ color: t.dim, fontWeight: '400' }}>  ({sp.pos.join('/')})</Text> : null}
                    </Text>
                    {rules.length > 0 && <Mono size={8.5} tone="dim" style={{ marginTop: 2 }}>{rules.join(' · ')}</Mono>}
                  </View>
                );
              })}
              <Mono size={9} tone="faint" weight="700" track={0.12} style={{ marginTop: 12 }}>THE SHAPE</Mono>
              <Mono size={10} style={{ marginTop: 4, lineHeight: fs(15) }}>
                {spots.length} starters · {shape.bench} bench{shape.taxi ? ` · ${shape.taxi} taxi` : ''}{shape.ir ? ` · ${shape.ir} IR` : ''} — {spots.length + shape.bench} draftable spots per team
              </Mono>
              <Mono size={8.5} tone="faint" style={{ marginTop: 6, lineHeight: fs(13) }}>
                Positions the league can roster: {[...new Set(spots.flatMap((s) => s.pos))].join(', ')}. Everything here is editable until the draft starts; it freezes the moment the room opens.
              </Mono>
              <View style={{ marginTop: 12, gap: 8 }}>
                <PrimaryButton label={busy ? '…' : '✓ CONFIRM & SAVE'} disabled={busy}
                  onPress={() => { tap(); setReviewOpen(false); void saveSpots(); }} />
                <LinkButton label="← GO BACK & ADJUST" onPress={() => { tap(); setReviewOpen(false); }} />
              </View>
            </ScrollView>
          </Overlay>

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
                {/* FLAGS AS A CONDITION (v0.300.0, founder: "allow flags as a
                    condition for position filters") — a spot only a flagged
                    player may stand in. Hidden until the league has flags. */}
                {flagLabels.length > 0 && (
                  <View style={{ marginTop: 10 }}>
                    <Mono size={9} tone="faint" weight="700" track={0.12}>FLAGGED ONLY</Mono>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 6 }}>
                      {flagLabels.map((fl) => {
                        const on = sp.fFlags.some((x) => x.toLowerCase() === fl.toLowerCase());
                        return (
                          <Pill key={fl} on={on} label={fl}
                            onPress={() => { setSpots((cur) => cur!.map((x, j) => j !== i ? x : { ...x, fFlags: on ? x.fFlags.filter((y) => y.toLowerCase() !== fl.toLowerCase()) : [...x.fFlags, fl] })); setSpotsDirty(true); }} />
                        );
                      })}
                    </View>
                    <Mono size={8} tone="faint" style={{ marginTop: 5, lineHeight: fs(12) }}>
                      {sp.fFlags.length ? 'only a player wearing one of these flags may fill this spot' : 'pick none to let anyone eligible fill it'}
                    </Mono>
                  </View>
                )}

                {/* ── THE ZERO-FILL RULE (v0.303.0) ────────────────────────
                    What this spot banks when it is EMPTY, or when whoever
                    stands in it scores nothing. Not available on a best-ball
                    spot: that spot fills itself, so "unfilled" is not a state
                    it has, and the server refuses the pair rather than storing
                    half of what was asked for. */}
                <View style={{ marginTop: 14 }}><LabelInfo label="ZERO-FILL"
                  info={'The points this spot banks when it is empty, or when its player scores nothing. Blank turns it off.\n\nNot available on a best-ball spot — that spot fills itself from whoever is left, so it is never unfilled. Turn best ball off first.'} /></View>
                {sp.bb ? null : (
                  <>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 }}>
                      <TextInput value={sp.zero}
                        onChangeText={(v) => { const n = v.replace(/[^0-9]/g, '').slice(0, 3); setSpots((cur) => cur!.map((x, j) => j !== i ? x : { ...x, zero: n })); setSpotsDirty(true); }}
                        placeholder="off" keyboardType="number-pad" placeholderTextColor={t.faint}
                        style={{ fontFamily: MONO, fontSize: fs(13), color: sp.zero ? t.warn : t.text, borderWidth: StyleSheet.hairlineWidth, borderColor: sp.zero ? t.warn : t.bd, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 6, width: 70, textAlign: 'center' }} />
                    </View>
                    <View style={{ flexDirection: 'row', gap: 5, flexWrap: 'wrap', marginTop: 6 }}>
                      {['', '5', '10', '15'].map((v) => (
                        <Pill key={v || 'off'} on={sp.zero === v} label={v === '' ? 'OFF' : v}
                          onPress={() => { setSpots((cur) => cur!.map((x, j) => j !== i ? x : { ...x, zero: v })); setSpotsDirty(true); }} />
                      ))}
                    </View>
                  </>
                )}

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
            {/* THE TOTAL IS THE CEILING (0192): bench 20 / taxi 8 / IR 8 were
                per-box numbers that ran a deep dynasty out of room with rounds
                to spare. The draft's 5–99 window is the only real limit. */}
            {([['BENCH', 'bench'], ['TAXI', 'taxi'], ['IR', 'ir']] as const).map(([label, key]) => (
              <View key={key} style={{ flexDirection: 'row', alignItems: 'center', gap: 3, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 3 }}>
                <Text style={{ fontFamily: MONO, fontSize: fs(8.5), fontWeight: '700', color: t.dim }}>{label}</Text>
                <Pressable disabled={busy || shape[key] === 0} onPress={() => { tap(); void saveShape({ ...shape, [key]: Math.max(0, shape[key] - 1) }); }} hitSlop={6}>
                  <Text style={{ fontFamily: MONO, fontSize: fs(11), color: t.you }}> − </Text>
                </Pressable>
                <Text style={{ fontFamily: MONO, fontSize: fs(9.5), fontWeight: '700', color: t.you, minWidth: 12, textAlign: 'center' }}>{shape[key]}</Text>
                <Pressable disabled={busy || shapeTotal >= MAX_ROUNDS} onPress={() => { tap(); void saveShape({ ...shape, [key]: shape[key] + 1 }); }} hitSlop={6}>
                  <Text style={{ fontFamily: MONO, fontSize: fs(11), color: t.you }}> ＋ </Text>
                </Pressable>
              </View>
            ))}
            {/* TWO NUMBERS SINCE 0193: the roster is what a team may HOLD, the
                draft is what it FILLS — IR spots are the difference. */}
            <Mono size={8.5} weight="700" tone="you">ROSTER = {rounds ?? shapeTotal} · DRAFT = {(rounds ?? shapeTotal) - shape.ir}{shape.ir > 0 ? ' (no IR)' : ''}{shapeTotal >= MAX_ROUNDS ? ` · ${MAX_ROUNDS} MAX` : ''}</Mono>
          </View>
          {/* ── THE TAXI SQUAD'S RULES (0196) ────────────────────────────
              Who may ride it and when it shuts — and unlike the shape, these
              move at ANY time. */}
          {shape.taxi > 0 && taxi && (
            <View style={{ marginTop: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 6, padding: 8 }}>
              <LabelInfo label="TAXI SQUAD"
                info={'Who may ride the taxi squad, and when it shuts.\n\nA locked taxi refuses new arrivals; taking a player OFF is always allowed, and YOU can move players either way at any time.\n\nUnknown experience cannot prove it qualifies, so a tenure rule excludes it.'} />
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap', marginTop: 6 }}>
                <Mono size={8} tone="dim">TENURE</Mono>
                {([[null, 'ANYONE'], [0, 'ROOKIES'], [1, '≤ 1 YR'], [2, '≤ 2 YRS'], [3, '≤ 3 YRS']] as const).map(([v, label]) => (
                  <Pill key={label} on={taxi.maxExp === v} label={label} onPress={() => void saveTaxi(v ?? -1, null)} />
                ))}
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap', marginTop: 6 }}>
                <Mono size={8} tone="dim">LOCK</Mono>
                <Pill on={taxi.lock} label="WK 1 KICKOFF" onPress={() => void saveTaxi(null, true)} />
                <Pill on={!taxi.lock} label="NEVER" onPress={() => void saveTaxi(null, false)} />
                {taxi.lockedNow && <Mono size={8} weight="700" tone="warn">🔒 LOCKED NOW</Mono>}
              </View>
            </View>
          )}
          {/* ── WHO MAY GO ON IR (0198) ──────────────────────────────────
              0164 hardcoded IR/Out, which is one league's answer. The
              vocabulary is the injury report's own and nothing else. */}
          {shape.ir > 0 && irTags && (
            <View style={{ marginTop: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 6, padding: 8 }}>
              <LabelInfo label="IR ELIGIBILITY"
                info={'Which injury designations may be stashed on IR.\n\nA player with none of these — a healthy one included — cannot be put on IR by anyone, YOU included: this is a fact about the player, not a deadline.\n\nSomeone already stashed stays put when you narrow the list.'} />
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap', marginTop: 6 }}>
                {([['IR', 'IR'], ['O', 'OUT'], ['D', 'DOUBTFUL'], ['Q', 'QUESTIONABLE']] as const).map(([tag, label]) => (
                  <Pill key={tag} on={irTags.includes(tag)} label={label} onPress={() => void saveIrTag(tag)} />
                ))}
              </View>
            </View>
          )}
          <Mono size={8} tone="faint" style={{ marginTop: 5, lineHeight: fs(12) }}>
            Any position combination per spot · BB fills itself · ✏️ carries the spot’s name, filters and ⛳ zero-fill (points it banks when empty or scoreless) · 🔎 limits who may fill the spot (teams / tenure / a flag — tenure filters need a pool re-seed) · you draft starters + bench + taxi, then stash · IR spots are extra room and are NOT drafted (you stash an injured player there) · IR needs a designation from the list above · stashed players can't start · locks at draft.
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
        );
      })()}
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

/** ── ✕ DELETE LEAGUE (0188) ──────────────────────────────────────────────
 *
 *  The commissioner's own way out. `admin_delete_league` has existed since 0044
 *  with the comment "commissioners cannot nuke a league"; 0188 is the deliberate
 *  loosening of that, and it pays for it with a TYPED CONFIRMATION rather than a
 *  second tap. A two-tap confirm is right for a drop — one player, one seat,
 *  recoverable by re-adding him. This ends a league for everybody in it, and the
 *  cascade takes the matchups, the rosters, the wallets and the register with
 *  it. Typing the name is the only friction proportional to that.
 *
 *  The check is server-side (case and inner whitespace forgiving); this screen
 *  only refuses to send an obviously-empty one, so the RULE lives in one place. */
function DeleteLeagueCard({ leagueId, onDeleted }: { leagueId: string; onDeleted: () => void }) {
  const t = useTheme();
  const [name, setName] = useState<string | null>(null);
  const [seats, setSeats] = useState<number | null>(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let dead = false;
    // commishOverview is already this screen's source for league facts, and it
    // is the only one that carries the NAME and the seat count together.
    commishOverview()
      .then((ls) => {
        const l = (ls ?? []).find((x) => x.league_id === leagueId);
        if (!dead && l) { setName(l.name); setSeats(l.rosters); }
      })
      .catch(() => {});
    return () => { dead = true; };
  }, [leagueId]);

  const go = async () => {
    if (busy || !typed.trim()) return;
    setBusy(true); setErr(null);
    try {
      const r = await commishDeleteLeague(leagueId, typed);
      if (!r.ok) { warn(); setErr(friendlyError(r.error ?? 'that didn\u2019t work')); return; }
      commit();
      onDeleted();
    } catch (x) { warn(); setErr(friendlyError(x)); }
    finally { setBusy(false); }
  };

  return (
    <View style={{ gap: 10 }}>
      <Mono size={10} tone="opp" weight="700" track={0.1}>THIS CANNOT BE UNDONE</Mono>
      <Mono size={9.5} tone="dim" style={{ lineHeight: 15 }}>
        Deleting {name ? `"${name}"` : 'this league'} removes it for everyone in it{seats ? ` — ${seats} seat${seats === 1 ? '' : 's'}` : ''}, along with
        every roster, matchup, lineup, wallet and transaction it holds. There is no restore.
      </Mono>
      <Mono size={9} tone="faint" style={{ lineHeight: 13 }}>
        Type the league name to confirm{name ? `: ${name}` : ''}
      </Mono>
      <TextInput value={typed} onChangeText={setTyped} autoCapitalize="none" autoCorrect={false}
        placeholder={name ?? 'league name'} placeholderTextColor={t.faint}
        style={{ borderWidth: 1, borderColor: t.bd, borderRadius: 6, backgroundColor: t.sh, color: t.text, fontFamily: MONO, fontSize: fs(11), paddingHorizontal: 10, paddingVertical: 9 }} />
      {err && <Mono size={9.5} tone="opp" style={{ lineHeight: 14 }}>{err}</Mono>}
      <Pressable disabled={busy || !typed.trim()} onPress={go}
        style={{ borderWidth: 1, borderColor: t.opp, borderRadius: 6, paddingVertical: 11, alignItems: 'center', opacity: busy || !typed.trim() ? 0.4 : 1 }}>
        <Mono size={10} weight="700" tone="opp">{busy ? 'DELETING…' : '✕ DELETE THIS LEAGUE FOREVER'}</Mono>
      </Pressable>
    </View>
  );
}
