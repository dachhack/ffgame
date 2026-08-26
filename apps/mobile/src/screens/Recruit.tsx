// The league board — find a league, post yours, recruit (0123).
//
// Three jobs on one screen, because they are one loop:
//   · BROWSE — open listings with claimable seats. Tap JOIN, pick a team name,
//     you're seated. The invite code never reaches this screen: join_from_board
//     resolves it server-side, so the listing being open IS the authorization.
//   · POST — commissioners of native leagues list them here with a blurb.
//     Closing (or the seats filling) takes a league off the board immediately.
//   · RECRUIT — any enrolled member can share their league's invite code
//     through the OS share sheet (league_invite gates on enrollment).
//   · START — create a league outright (v0.226.0), and redeem an invite code
//     someone sent you (v0.225.0). Both landed here rather than on their own
//     screens because this is already the one place the app answers "how do I
//     get into a league"; a separate screen would split that question in two.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, RefreshControl, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { crestInitial } from '@drip/core/data/crest';
import {
  closeLeagueListing, commishOverview, friendlyError, joinFromBoard, leagueBoard, leagueInvite, leaguePreview, leagueListingState,
  type BoardPreview, type LeagueIdentity,
  postLeagueListing, redeemCommish, nativeJoin, createNativeLeague, seedLeaguePool, type LeagueContinuity, isDynastyContinuity, contractRosterDepth,
  setLeagueFormat, type LeagueFormat,
  nativeGenerateSchedule, myFeatures, isAdmin, type AdminLeague, type BoardListing,
  myEnrollments, type Enrollment,
} from '@drip/core/data/liveApi';
import {
  readBlueprint, applyBlueprint, blueprintSummary, type LeagueBlueprint,
} from '@drip/core/data/leagueBlueprint';
import { inviteMessage } from '@drip/core/data/invite';
import { rosterLabel } from '@drip/core/engine/classic';
import { buildDraftPool } from '@drip/core/data/nativeLeague';
import { useTheme, MONO, alpha } from '../theme.native';
import { tap, commit, warn } from '../ui/feedback';
import { Card, Chip, Display, LinkButton, Mono, Notice, PrimaryButton } from '../ui/prims';
import { Overlay } from '../ui/Overlay';
import { LabelInfo } from '../ui/InfoChip';

/** League crest with an initial fallback (same reasoning as Leagues.Crest). */
function Crest({ url, name, size = 40 }: { url?: string | null; name?: string | null; size?: number }) {
  const t = useTheme();
  const [failed, setFailed] = useState(false);
  const show = url && !failed;
  return (
    <View style={{ width: size, height: size, borderRadius: Math.round(size * 0.19), overflow: 'hidden', flexShrink: 0, backgroundColor: t.bg, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, alignItems: 'center', justifyContent: 'center' }}>
      {show
        ? <Image source={{ uri: url }} onError={() => setFailed(true)} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
        : <Text style={{ fontFamily: MONO, fontSize: Math.round(size * 0.42), fontWeight: '700', color: t.faint }}>{crestInitial(name)}</Text>}
    </View>
  );
}

/** The board's branches. 'root' is the menu; the rest are one question each. */
type Node = 'root' | 'browse' | 'create' | 'join' | 'post' | 'commish';
const NODE_TITLE: Record<Node, string> = {
  root: 'League board', browse: 'Open leagues', create: 'Start a league',
  join: 'Join with a code', post: 'Post & recruit', commish: 'Commissioner code',
};
const NODE_SUB: Record<Node, string> = {
  root: 'Find one, start one, or join with a code.',
  browse: 'Open leagues looking for managers.',
  create: 'Six or seven questions, one at a time.',
  join: "Paste the code a friend sent you.",
  post: 'List a league you run, or share its code.',
  commish: 'Run a league without holding a seat.',
};

/** The create branch's steps, in the order the old form asked them. */
type Step = 'copy' | 'game' | 'season' | 'format' | 'name' | 'draft' | 'review';
const STEP_TITLE: Record<Step, string> = {
  copy: 'COPY SETTINGS', game: 'WHICH GAME', season: 'NEXT SEASON', format: 'FORMAT',
  name: 'NAME & SIZE', draft: 'THE DRAFT', review: 'REVIEW',
};

/** One row of the root menu — a destination, not a control. */
function MenuRow({ icon, title, sub, onPress }: {
  icon: string; title: string; sub: string; onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} android_ripple={{ color: alpha(t.you, 16) }}
      style={({ pressed }) => ({
        backgroundColor: t.surface, overflow: 'hidden',
        borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd,
        borderRadius: 12, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 11,
        opacity: pressed ? 0.85 : 1,
      })}>
      <View style={{ width: 40, height: 40, borderRadius: 8, backgroundColor: t.bg, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontSize: 17 }}>{icon}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontSize: 14.5, fontWeight: '700', color: t.text }}>{title}</Text>
        <Text style={{ fontSize: 11.5, color: t.mid, marginTop: 2 }}>{sub}</Text>
      </View>
      <Mono size={10} tone="you" weight="700">→</Mono>
    </Pressable>
  );
}

export function Recruit({ onBack, onJoined, onCreated, initial }: {
  onBack: () => void;
  /** 'create' — arrived from ＋ ADD A LEAGUE rather than 🔎 FIND A LEAGUE, so
   *  open the START A LEAGUE card and scroll to it. The board's three jobs
   *  share one screen (see the header), which is right for browsing and wrong
   *  for someone who came here to make one: they would land on a list of other
   *  people's leagues with their own answer below the fold. */
  initial?: 'root' | 'browse' | 'create';
  /** A join succeeded — the leagues list needs a reload. */
  onJoined: () => void;
  /** A LEAGUE was created — open it on its roster settings (v0.296.6). The
   *  draft drafts the roster the league is SHAPED for, and both the shape and
   *  the draft freeze the moment it starts, so the settings come first. */
  onCreated?: (leagueId: string, name: string, rosterId: number | null) => void;
}) {
  const t = useTheme();
  const [rows, setRows] = useState<BoardListing[] | null>(null);
  const [myLeagues, setMyLeagues] = useState<AdminLeague[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [joinFor, setJoinFor] = useState<BoardListing | null>(null);
  const [previewFor, setPreviewFor] = useState<BoardListing | null>(null);
  const [preview, setPreview] = useState<BoardPreview | null>(null);
  const [teamDraft, setTeamDraft] = useState('');
  const [postFor, setPostFor] = useState<AdminLeague | null>(null);
  const [blurbDraft, setBlurbDraft] = useState('');
  const [duesDraft, setDuesDraft] = useState('');
  const [joined, setJoined] = useState<string | null>(null); // league name, for the success note
  const [commishDraft, setCommishDraft] = useState('');      // commish-code redemption
  const [inviteDraft, setInviteDraft] = useState('');        // invite-code join (native_join)
  const [inviteTeam, setInviteTeam] = useState('');
  // Create-a-league (v0.226.0). The form is the web's post-v0.221.0 trim:
  // only what has NO setter after creation gets asked here — game type, name,
  // teams, draft type, pace, clock. Roster size and position limits are
  // defaults the game type picks, adjustable from ⚑ COMMISH until the draft.
  const [canCreate, setCanCreate] = useState(false);
  // WHERE IN THE TREE. The collapse-and-scroll this replaced was the old
  // shape's apology for a screen that answered five questions at once: open
  // the right card, then jump the scroll to it. A branch you can navigate to
  // needs neither.
  const [node, setNode] = useState<Node>(
    initial === 'create' ? 'create' : initial === 'browse' ? 'browse' : 'root');
  const [stepIx, setStepIx] = useState(0);
  // Every branch starts at the top of its own screen; carrying the previous
  // one's scroll into it is how a tree feels broken.
  const scrollRef = useRef<ScrollView>(null);
  useEffect(() => { scrollRef.current?.scrollTo({ y: 0, animated: false }); }, [node, stepIx]);
  // NO DEFAULT (v0.251.0) — same rule as the web. This used to start on
  // 'drip', and a commissioner who never tapped 🏈 NORMAL got a drip league
  // with a normie name; the choice freezes at the draft, so the mistake is
  // permanent. The form refuses to submit until the game is chosen.
  const [game, setGame] = useState<'drip' | 'classic' | null>(null);
  // CONTINUITY (0185): what carries into next season — redraft / keeper /
  // dynasty, an axis on top of either game.
  const [continuity, setContinuity] = useState<LeagueContinuity>('redraft');
  const [keepN, setKeepN] = useState(4);      // keeper: how many each team keeps
  const [rookieN, setRookieN] = useState(3);  // dynasty: rookie-draft rounds
  const [nameDraft, setNameDraft] = useState('');
  const [teamCount, setTeamCount] = useState(8);
  const [draftMode, setDraftMode] = useState<'snake' | 'auction'>('snake');
  // Contract types (0218) preset the room: bids become salaries, so the
  // startup can only be an auction — picking one forces the mode.
  const contractType = continuity === 'contract' || continuity === 'contract_dynasty';
  const pickContinuity = (c: LeagueContinuity) => {
    setContinuity(c);
    if (c === 'contract' || c === 'contract_dynasty') setDraftMode('auction');
  };
  const contLabel = continuity === 'contract_dynasty' ? '📜 CONTRACT DYNASTY '
    : continuity === 'contract' ? '📜 CONTRACT '
    : continuity === 'dynasty' ? '🏰 DYNASTY '
    : continuity === 'keeper' ? '★ KEEPER ' : '';
  // FORMAT (0221/0222): how the season is WON.
  const [format, setFormat] = useState<LeagueFormat>('standard');
  const [pace, setPace] = useState<'live' | 'slow'>('live');
  const [clockDraft, setClockDraft] = useState('90');
  const [makeNote, setMakeNote] = useState('');
  // COPY THE SETTINGS FROM AN EXISTING LEAGUE (founder). The picker lists the
  // leagues you hold a SEAT in rather than the ones you commission, because
  // the row from my_teams is the only place continuity, format and game mode
  // can be read — commish_overview carries none of the three, and defaulting
  // them would hand back a redraft drip league wearing a dynasty league's name.
  const [mine, setMine] = useState<Enrollment[]>([]);
  const [copyFrom, setCopyFrom] = useState<Enrollment | null>(null);
  const [copyBp, setCopyBp] = useState<LeagueBlueprint | null>(null);
  const [copyBusy, setCopyBusy] = useState(false);
  // What the post-create setters actually managed. Kept after the league is
  // made so the note can name a step that refused rather than claiming a
  // clean copy — the league exists either way and nothing rolls back.
  const [copyReport, setCopyReport] = useState<string[] | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const [b, cl, en] = await Promise.all([
        leagueBoard(),
        // The commissioner's own leagues feed the POST section. Only native
        // ones can be listed (the board's promise is a claimable seat).
        commishOverview().then((ls) => ls.filter((l) => l.provider === 'native')).catch(() => [] as AdminLeague[]),
        // Copy-from candidates. Native only: an imported Sleeper league has no
        // settings of ours to read. The userId argument is vestigial — my_teams
        // answers for auth.uid() — so what is passed here cannot matter.
        myEnrollments('').then((es) => es.filter((e) => e.league?.provider === 'native')).catch(() => [] as Enrollment[]),
      ]);
      setRows(b); setMyLeagues(cl); setMine(en);
    } catch (e) { setErr(friendlyError(e)); setRows([]); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  // Same entitlement the web's create button checks — admins always qualify
  // (has_native() is `is_admin() or the flag`), so both are asked here rather
  // than advertising a door the server would shut.
  useEffect(() => {
    Promise.all([myFeatures().catch(() => ({} as Record<string, boolean>)), isAdmin().catch(() => false)])
      .then(([f, a]) => setCanCreate(!!a || f.native === true));
  }, []);
  const refresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const listedIds = new Set((rows ?? []).filter((r) => r.commish).map((r) => r.league_id));

  const doJoin = async () => {
    if (!joinFor || busy) return;
    setBusy(true); setErr(null);
    const target = joinFor;
    try {
      const r = await joinFromBoard(target.league_id, teamDraft.trim() || undefined);
      if (!r.ok) { warn(); setErr(friendlyError(r.error ?? 'could not join')); }
      else if ((r as { status?: string }).status === 'waitlisted') {
        commit(); setJoined(`the waiting room for ${target.name} — the commissioner deals you in from there`); onJoined();
      } else { commit(); setJoined(target.name); onJoined(); }
    } catch (e) { warn(); setErr(friendlyError(e)); }
    finally { setBusy(false); setJoinFor(null); setTeamDraft(''); await load(); }
  };

  const doPost = async () => {
    if (!postFor || busy) return;
    setBusy(true); setErr(null);
    try {
      // dues: trimmed text posts, blank posts as '' which CLEARS server-side —
      // wiping the field is how a commissioner retracts a dues line
      const r = await postLeagueListing(postFor.league_id, blurbDraft.trim() || null, duesDraft.trim());
      if (!r.ok) { warn(); setErr(friendlyError(r.error ?? 'could not post')); } else commit();
    } catch (e) { warn(); setErr(friendlyError(e)); }
    finally { setBusy(false); setPostFor(null); setBlurbDraft(''); setDuesDraft(''); await load(); }
  };

  const unlist = async (leagueId: string) => {
    if (busy) return;
    setBusy(true);
    try { const r = await closeLeagueListing(leagueId); if (!r.ok) { warn(); setErr(friendlyError(r.error ?? 'could not unlist')); } else commit(); }
    catch (e) { warn(); setErr(friendlyError(e)); }
    finally { setBusy(false); await load(); }
  };

  // Redeem a commissioner code — whoever redeems it becomes the league's
  // commissioner (0039), with or without a team. This is how a league gets a
  // non-playing commissioner: redeem here, never take a seat, and the league
  // shows up on your leagues screen as ⚑ MANAGE.
  const doRedeemCommish = async () => {
    const code = commishDraft.trim();
    if (!code || busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await redeemCommish(code);
      if (r.ok) { commit(); setCommishDraft(''); setJoined(`${r.league ?? 'the league'} — as its commissioner`); onJoined(); }
      else { warn(); setErr(friendlyError(r.error ?? 'invalid commissioner code')); }
    } catch (e) { warn(); setErr(friendlyError(e)); }
    finally { setBusy(false); await load(); }
  };

  // Redeem an INVITE code — a friend's league, not the public board.
  //
  // This was the app's onboarding dead end: both this screen and the
  // commissioner's ⚑ RECRUIT button share an invite code ("Invite code: XXXX"),
  // and nothing in the app could accept one. Someone who installed the app
  // holding a code from a friend had to go find the website. Meanwhile the
  // COMMISSIONER code — the rarer, more advanced path — has had a box here all
  // along, which made the omission read as deliberate rather than missing.
  //
  // native_join is the whole flow: the code IS the seat, so it claims the
  // lowest open roster with no identity-matching step and no commissioner
  // approval. The team name is optional and renameable later.
  const doJoinByCode = async () => {
    const code = inviteDraft.trim();
    if (!code || busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await nativeJoin(code, inviteTeam.trim() || undefined);
      if (r.ok) {
        commit(); setInviteDraft(''); setInviteTeam('');
        // A FULL LEAGUE IS A SUCCESS WITHOUT A SEAT (v0.325.0). native_join
        // (0125) waitlists rather than turning you away, returning
        // `{ok: true, status: 'waitlisted'}` — and this branch announced "you
        // joined <league>", which was a straight lie: no team, no lineup, and
        // nothing on the leagues list to show for it. The BOARD join in this
        // same file has said it properly since 0125; the invite-code join,
        // which is the path every recruit actually arrives on, never did.
        setJoined((r as { status?: string }).status === 'waitlisted'
          ? `the waiting room for ${r.league ?? 'that league'} — it's full, so the commissioner deals you in from there`
          : (r.league ?? 'your league'));
        onJoined();
      } else { warn(); setErr(friendlyError(r.error ?? 'that code did not work')); }
    } catch (e) { warn(); setErr(friendlyError(e)); }
    finally { setBusy(false); await load(); }
  };

  // Create → seed the pool → generate the schedule. Three steps, and the
  // ORDER is load-bearing: a league with no pool can't draft and a league with
  // no schedule has no season, so a failure in either later step leaves the
  // league standing but incomplete — which is why each one reports what broke
  // rather than a generic failure, and why the league still lands on the
  // leagues screen either way (it exists; it just needs another go).
  // Pick a league to copy, read its settings, and prefill the form with the
  // ones the form SHOWS. The rest of the blueprint (roster size, position
  // caps, auction budget and lots, the overnight window) rides straight to
  // create at submit — see doCreate. That split is the rule: what you can see,
  // you can change; what the form does not ask, comes from the source league.
  const pickCopy = async (e: Enrollment | null) => {
    setCopyFrom(e); setCopyBp(null); setCopyReport(null);
    if (!e) return;
    setCopyBusy(true); setErr(null);
    try {
      const bp = await readBlueprint(e.league_id, {
        rosters: e.league?.rosters ?? null,
        continuity: e.league?.continuity ?? null,
        format: e.league?.format ?? null,
        game_mode: e.league?.game_mode ?? null,
      });
      setCopyBp(bp);
      setGame(bp.gameMode);
      pickContinuity(bp.continuity);
      // pickContinuity forces auction for contract types; otherwise the source
      // league's own room. 'linear' has no chip here, and it drafts in the same
      // fixed order a snake reverses, so it lands on snake rather than nothing.
      if (bp.continuity !== 'contract' && bp.continuity !== 'contract_dynasty') {
        setDraftMode(bp.mode === 'auction' ? 'auction' : 'snake');
      }
      setTeamCount(bp.teams);
      setFormat(bp.format);
      // The clock is stored in seconds and asked for in either seconds or
      // hours, so a slow league's 12h has to come back as 12 and not 43200.
      if (bp.pickSeconds >= 3600) { setPace('slow'); setClockDraft(String(Math.round(bp.pickSeconds / 3600))); }
      else { setPace('live'); setClockDraft(String(bp.pickSeconds)); }
    } catch (x) { setErr(friendlyError(x)); setCopyFrom(null); }
    finally { setCopyBusy(false); }
  };

  const doCreate = async () => {
    const nm = nameDraft.trim();
    if (!nm || busy || !game) return;
    // The busy note NAMES the game — the last chance to notice a wrong tap
    // before it freezes at the draft.
    setBusy(true); setErr(null); setMakeNote(`Creating your ${contLabel}${game === 'classic' ? 'NORMAL' : 'DRIP'} league…`);
    try {
      const secs = pace === 'slow' ? Math.max(1, Number(clockDraft) || 12) * 3600 : Math.max(15, Number(clockDraft) || 90);
      // Same defaults the web derives from the game type (v0.221.0): drip
      // keeps the pre-0071 position limits, classic takes none because its
      // shape is the starting-lineup spec.
      // Contract types draft DEEP (v0.352.0): the roster covers everyone the
      // AI market prices above the $1 floor, so startable players can't fall
      // through to free street deals.
      const bp = copyBp;
      const rounds = bp ? bp.rounds
        : contractType ? contractRosterDepth(teamCount, 200) : game === 'classic' ? 15 : 12;
      const caps = bp ? bp.posCaps : game === 'classic' ? null : { QB: 3, RB: null, WR: null, TE: 3, K: 1, DEF: 1 };
      const contN = continuity === 'keeper' ? keepN : isDynastyContinuity(continuity) ? rookieN : null;
      const r = await createNativeLeague(nm, '2026', teamCount, rounds, secs, draftMode,
        bp ? bp.budget : 200, bp ? bp.lotSeconds : 15,
        bp && draftMode === 'auction' ? bp.maxLots : 1,
        bp ? bp.nightStartMin : null, bp ? bp.nightEndMin : null, caps, game,
        continuity, contN);
      if (!r.ok || !r.league_id) { warn(); setErr(friendlyError(r.error ?? 'could not create the league')); return; }
      if (format !== 'standard') {
        setMakeNote(`Setting the ${format === 'guillotine' ? '🔪 GUILLOTINE' : '🧛 VAMPIRE'} format…`);
        const fr = await setLeagueFormat(r.league_id, format);
        if (!fr.ok) { warn(); setErr(friendlyError(fr.error ?? 'could not set the format')); return; }
      }
      // THE COPY'S SECOND HALF, and the reason it runs HERE rather than
      // inside create: scoring, waivers, the taxi squad and the classic shape
      // have no create-time argument, so they are setters on a league that
      // already exists. Any one can refuse on its own, and none of it rolls
      // back — so this collects what failed and shows it rather than aborting
      // a league that is already real and already named.
      //
      // format is blanked because the block above just applied the FORM's
      // choice, which is the one the commissioner can see and may have changed
      // since copying. Re-applying the source's would also re-preset a
      // guillotine league's $1000 FAAB market, wiping the budget copied below.
      if (bp) {
        setMakeNote('Copying the settings…');
        const steps = await applyBlueprint(r.league_id, {
          ...bp, format: 'standard',
          teams: teamCount, rounds, pickSeconds: secs, mode: draftMode,
          gameMode: game, continuity, continuityN: contN,
        });
        setCopyReport(steps.filter((s) => !s.ok).map((s) => `${s.step} — ${friendlyError(s.error ?? 'refused')}`));
      }
      setMakeNote('Building the 2026 player pool…');
      const pool = await seedLeaguePool(r.league_id, await buildDraftPool(setMakeNote));
      if (!pool.ok) { warn(); setErr(friendlyError(pool.error ?? 'league created, but the player pool failed — reseed it from the draft room')); return; }
      setMakeNote('Generating the season schedule…');
      const sched = await nativeGenerateSchedule(r.league_id, 14);
      if (!sched.ok) { warn(); setErr(friendlyError(sched.error ?? 'league created, but the schedule failed — regenerate it from ⚑ COMMISH')); return; }
      commit();
      // The success note names the game too — created is the moment a wrong
      // mode is cheapest to notice.
      setJoined(`${nm}, a ${contLabel}${game === 'classic' ? '🏈 NORMAL' : '◈ DRIP'} league — you're its commissioner`);
      // Back to the menu with the form reset — the branch is done, and a
      // create screen still holding the league you just made is a trap.
      setNode('root'); setStepIx(0); setNameDraft('');
      // Into the new league, on its roster settings. The `finally` below still
      // reloads the list behind this screen for the way back.
      onCreated?.(r.league_id, nm, r.roster_id ?? null);
    } catch (e) { warn(); setErr(friendlyError(e)); }
    finally { setBusy(false); setMakeNote(''); onJoined(); await load(); }
  };

  const share = async (leagueId: string) => {
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
    } catch { /* sheet dismissed */ }
  };

  // The step list is COMPUTED: no copy step when there is nothing to copy
  // from, so a first league is never asked a question with one answer.
  const STEPS: Step[] = [...(mine.length > 0 ? (['copy'] as Step[]) : []), 'game', 'season', 'format', 'name', 'draft', 'review'];
  const step: Step = STEPS[Math.min(stepIx, STEPS.length - 1)];
  // The two steps that can be WRONG rather than merely unfinished. Everything
  // else has a default that is a real answer, so NEXT is always allowed.
  const canNext = step === 'game' ? game !== null : step === 'name' ? !!nameDraft.trim() : true;

  if (rows === null) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 }}>
        <ActivityIndicator color={t.you} />
        <Mono size={9.5} tone="faint">Loading the league board…</Mono>
      </View>
    );
  }

  return (
    <ScrollView ref={scrollRef} style={{ flex: 1, backgroundColor: t.bg }} contentContainerStyle={{ padding: 12, paddingBottom: 40, gap: 10 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={t.you} />}>
      {/* A TREE, NOT ONE LONG SCREEN (founder: "Let's make this a tree of
          selection screens rather one big screen").

          The board answers five different questions — browse, start one, join
          with a code, post yours, redeem a commish code — and it used to answer
          all five at once, stacked, with the longest of them (the create form,
          eight questions) in the middle. Every visit paid for every answer.

          So: a root MENU, one screen per branch, and the create branch stepped.
          Each screen asks one thing and says how far along you are. The header
          is shared and its ← goes back UP the tree — out of the board only from
          the root, which is the one place "back" means leaving. */}
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Display size={20}>{NODE_TITLE[node]}</Display>
          <Mono size={9.5} tone="faint">{NODE_SUB[node]}</Mono>
        </View>
        <LinkButton label="← back" onPress={() => { tap(); if (node === 'root') onBack(); else { setNode('root'); setStepIx(0); } }} />
      </View>

      {!!err && <Notice tone="opp"><Mono size={10} tone="opp">{err}</Mono></Notice>}
      {!!joined && (
        <Notice tone="you">
          <Mono size={10} tone="you">✓ You're in {joined} — it's on your leagues screen now.</Mono>
        </Notice>
      )}

      {/* A COPY THAT ONLY PARTLY LANDED SAYS SO. The league exists and is
          usable either way, so this is a note rather than an error — but a
          silent partial copy would be found in week 1, from a score. */}
      {copyReport !== null && copyReport.length > 0 && (
        <Notice tone="warn">
          <Mono size={10} tone="warn">⚠ The league was created, but some settings didn't copy:</Mono>
          {copyReport.map((line, i) => (
            <Mono key={`cr-${i}`} size={9.5} tone="warn" style={{ marginTop: 3, lineHeight: 13 }}>· {line}</Mono>
          ))}
          <Mono size={9} tone="dim" style={{ marginTop: 5, lineHeight: 13 }}>Set those by hand in ⚑ COMMISH — everything else carried.</Mono>
        </Notice>
      )}

      {/* ── THE ROOT MENU ──────────────────────────────────────────────────
          Ordered by how often a visit wants it, not by how the code is laid
          out: most people arriving here were handed a code or want to see
          what's open. A branch with nothing behind it does not render — an
          empty POST row would advertise a screen that would greet a
          commissioner with nothing of theirs to post. */}
      {node === 'root' && (
        <>
          <MenuRow icon="🔎" title="Browse open leagues"
            sub={rows.length ? `${rows.length} looking for managers` : 'nothing listed right now'}
            onPress={() => { tap(); setNode('browse'); }} />
          {canCreate && (
            <MenuRow icon="＋" title="Start a league"
              sub="Create it here, invite friends, draft in the app"
              onPress={() => { tap(); setNode('create'); setStepIx(0); }} />
          )}
          <MenuRow icon="→" title="Join with an invite code"
            sub="A friend sent you a code" onPress={() => { tap(); setNode('join'); }} />
          {myLeagues.length > 0 && (
            <MenuRow icon="📣" title="Post & recruit"
              sub={`List ${myLeagues.length === 1 ? 'your league' : 'your leagues'} on the board, share the code`}
              onPress={() => { tap(); setNode('post'); }} />
          )}
          <MenuRow icon="⚑" title="Redeem a commissioner code"
            sub="Run a league without holding a seat in it"
            onPress={() => { tap(); setNode('commish'); }} />
        </>
      )}

      {/* ── BROWSE ─────────────────────────────────────────────────────── */}
      {node === 'browse' && (
        <>
      {/* BROWSE */}
      {rows.length === 0 && (
        <Card>
          <Display size={14}>Nothing posted right now</Display>
          <Mono size={10} style={{ marginTop: 6, lineHeight: 16 }}>
            Commissioners post leagues here when they have seats to fill. Pull down to check again — or start your own league on the web and post it.
          </Mono>
        </Card>
      )}
      {rows.map((r) => (
        <Card key={r.league_id} style={{ borderLeftWidth: 3, borderLeftColor: r.mine ? t.bd : t.you }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Crest url={r.avatar_url} name={r.name} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ fontSize: 14.5, fontWeight: '700', color: t.text }}>{r.name}</Text>
              <Mono size={9} tone="faint" style={{ marginTop: 2 }}>
                {r.season} · {r.draft_mode.toUpperCase()} draft {r.draft_status === 'pending' ? 'not started' : r.draft_status}
              </Mono>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={{ fontFamily: MONO, fontSize: 15, fontWeight: '700', color: t.you }}>{r.seats_open}</Text>
              <Mono size={7.5} tone="faint" track={0.08}>OF {r.seats_total} OPEN</Mono>
            </View>
          </View>
          {/* the card tells the truth (0223): what KIND of league, and the money */}
          {!!r.identity && <Mono size={8.5} tone="dim" style={{ marginTop: 6 }}>{identityLine(r.identity)}</Mono>}
          {!!r.dues && <Mono size={9} tone="warn" weight="700" style={{ marginTop: 3 }}>💵 DUES: {r.dues}</Mono>}
          {!!r.blurb && <Mono size={10} style={{ marginTop: 8, lineHeight: 15 }}>{r.blurb}</Mono>}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 }}>
            {r.mine ? (
              <>
                <Mono size={9.5} tone="you" weight="700">✓ you're in this one</Mono>
                <View style={{ flex: 1 }} />
                <Chip label="⇪ RECRUIT" onPress={() => void share(r.league_id)} />
              </>
            ) : (
              <View style={{ flex: 1 }}>
                {/* Look before you join (0156): the door is a REVIEW, and the
                    seat is only taken from inside it — the founder's rule that
                    only committed users take a spot. */}
                <PrimaryButton label="⌕ REVIEW THIS LEAGUE" disabled={busy}
                  onPress={() => { tap(); setPreviewFor(r); setPreview(null); void leaguePreview(r.league_id).then(setPreview).catch(() => setPreview({ ok: false, error: 'could not load' })); }} />
              </View>
            )}
          </View>
        </Card>
      ))}
        </>
      )}

      {/* ── START A LEAGUE, ONE QUESTION AT A TIME ──────────────────────────
          The steps are the form's own order, which was already the right one:
          copying answers most of what follows, the GAME decides what the rest
          of the questions even mean, and the name comes late because it is the
          only one you cannot get wrong.

          COPY only appears when there is something to copy from, so a first
          league is not asked a question with one possible answer. That is why
          the step list is computed rather than constant — and why the counter
          says "of 6" for that founder and "of 7" for this one. */}
      {node === 'create' && canCreate && (
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
            <Mono size={9} tone="faint" track={0.12}>STEP {stepIx + 1} OF {STEPS.length} · {STEP_TITLE[step]}</Mono>
            <View style={{ flex: 1 }} />
            {/* One pip per step: how far in, and how far left, without a bar
                that would need a width to mean anything. */}
            <View style={{ flexDirection: 'row', gap: 3 }}>
              {STEPS.map((s, i) => (
                <View key={`pip-${s}`} style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: i <= stepIx ? t.you : t.bd }} />
              ))}
            </View>
          </View>

          <View style={{ gap: 10 }}>
            {step === 'copy' && (
              <View>
              {/* COPY SETTINGS FROM AN EXISTING LEAGUE — first, because it
                  answers most of the questions below it. Picking one fills in
                  the form and carries the rest (roster size, position caps,
                  auction budget and lots, the overnight window) straight to
                  create; scoring, waivers, the taxi squad and a classic
                  league's own shape are applied right after, since none of
                  them has a create-time argument.

                  It lists leagues you hold a SEAT in, not ones you merely
                  commission: continuity, format and game mode are readable
                  only off the my_teams row, and a copy that quietly defaulted
                  those three would hand back a redraft drip league wearing a
                  contract dynasty league's name. */}
              {mine.length > 0 && (
                <View>
                  <LabelInfo label="COPY SETTINGS FROM"
                    info={'Start a league shaped like one you already run.\n\nCARRIES: teams, roster size, draft type and clock, auction budget and lots, position limits, drip vs normal, keeper/dynasty, the format, the scoring catalog, waivers and FAAB, trade review, the taxi squad and IR tags.\n\nDOES NOT CARRY: the name, the members, the draft itself, or anything the season has already written.\n\nEverything it fills in is still yours to change before you create.'} />
                  <View style={{ flexDirection: 'row', gap: 5, marginTop: 5, flexWrap: 'wrap' }}>
                    <Chip label="START FRESH" on={!copyFrom} onPress={() => { tap(); void pickCopy(null); }} />
                    {mine.map((e) => (
                      <Chip key={`cp-${e.league_id}`} label={e.league?.name ?? 'League'}
                        on={copyFrom?.league_id === e.league_id}
                        onPress={() => { tap(); void pickCopy(e); }} />
                    ))}
                  </View>
                  {copyBusy && <Mono size={8.5} tone="faint" style={{ marginTop: 5 }}>reading its settings…</Mono>}
                  {copyBp && !copyBusy && (
                    <View style={{ marginTop: 6, gap: 2 }}>
                      {blueprintSummary(copyBp).map((line, i) => (
                        <Mono key={`bp-${i}`} size={8.5} tone="dim" style={{ lineHeight: 13 }}>· {line}</Mono>
                      ))}
                      {copyBp.unread.length > 0 && (
                        <Mono size={8.5} tone="warn" style={{ marginTop: 3, lineHeight: 13 }}>
                          ⚠ couldn't read {copyBp.unread.join(', ')} — that part keeps the defaults
                        </Mono>
                      )}
                    </View>
                  )}
                </View>
              )}
              </View>
            )}
            {step === 'game' && (
              <View>
                <LabelInfo label="WHICH GAME?"
                  info={'This is the choice that decides what your league PLAYS, and it locks in at the draft.\n\n◈ DRIP — your 8 starters play head-to-head in real time as the games run: drips, nukes and power-ups on live play-by-play.\n\n🏈 NORMAL — fantasy the way you already know it: a positional starting lineup, weekly point totals, standard scoring you can tune.'} />
                <View style={{ flexDirection: 'row', gap: 5, marginTop: 5 }}>
                  <Chip label="◈ DRIP" on={game === 'drip'} onPress={() => { tap(); setGame('drip'); }} />
                  <Chip label="🏈 NORMAL" on={game === 'classic'} onPress={() => { tap(); setGame('classic'); }} />
                </View>
                {game === null && (
                  <Mono size={8.5} tone="dim" style={{ marginTop: 5 }}>pick one — the form won't submit without it</Mono>
                )}
              </View>
            )}
            {step === 'season' && (
              <View>
                {/* CONTINUITY (0185): redraft / keeper / dynasty. One
                    selection; the number it needs appears with it. Editable
                    any time in 🎮 MODE. */}
                <View style={{ marginTop: 10 }}>
                  <LabelInfo label="NEXT SEASON"
                    info={'What carries into next season:\n\nREDRAFT — every season starts fresh; full draft, nothing carries.\n\n★ KEEPER — each team carries the chosen number of players and redrafts the rest.\n\n🏰 DYNASTY — teams keep everyone except the rookie-draft spots and draft rookies each year, with three seasons of tradeable picks dealt from day one.\n\n📜 CONTRACT — a salary-cap league: the startup is an auction and every winning bid becomes that player\'s salary; you assign deal lengths during the draft, and the cap holds all season.\n\n📜🏰 CONTRACT DYNASTY — contracts AND dynasty: bids become salaries, rookies sign scale deals (4yr default — a 📜 SALARY setting), plus the rookie rounds and the pick horizon.'} />
                </View>
                <View style={{ flexDirection: 'row', gap: 5, marginTop: 5, flexWrap: 'wrap', alignItems: 'center' }}>
                  <Chip label="REDRAFT" on={continuity === 'redraft'} onPress={() => { tap(); pickContinuity('redraft'); }} />
                  <Chip label="★ KEEPER" on={continuity === 'keeper'} onPress={() => { tap(); pickContinuity('keeper'); }} />
                  <Chip label="🏰 DYNASTY" on={continuity === 'dynasty'} onPress={() => { tap(); pickContinuity('dynasty'); }} />
                  <Chip label="📜 CONTRACT" on={continuity === 'contract'} onPress={() => { tap(); pickContinuity('contract'); }} />
                  <Chip label="📜🏰 CONTRACT DYNASTY" on={continuity === 'contract_dynasty'} onPress={() => { tap(); pickContinuity('contract_dynasty'); }} />
                </View>
                {(continuity === 'keeper' || isDynastyContinuity(continuity)) && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 }}>
                    <Mono size={9} tone="dim">{continuity === 'keeper' ? 'each team keeps' : 'rookie draft runs'}</Mono>
                    <Pressable hitSlop={6} onPress={() => { tap(); (continuity === 'keeper' ? setKeepN : setRookieN)((v) => Math.max(1, v - 1)); }}>
                      <Text style={{ fontFamily: MONO, fontSize: 16, color: t.dim }}>−</Text>
                    </Pressable>
                    <Text style={{ fontFamily: MONO, fontSize: 15, fontWeight: '700', color: t.text, minWidth: 24, textAlign: 'center' }}>
                      {continuity === 'keeper' ? keepN : rookieN}
                    </Text>
                    <Pressable hitSlop={6} onPress={() => { tap(); continuity === 'keeper' ? setKeepN((v) => Math.min(11, v + 1)) : setRookieN((v) => Math.min(9, v + 1)); }}>
                      <Text style={{ fontFamily: MONO, fontSize: 16, color: t.dim }}>＋</Text>
                    </Pressable>
                    <Mono size={9} tone="dim">{continuity === 'keeper' ? 'into next season' : 'rounds each season'}</Mono>
                  </View>
                )}
                {contractType && (
                  <Mono size={8.5} tone="dim" style={{ marginTop: 5 }}>
                    preset — auction (bids become salaries, cap at the budget) · FAAB waivers (bids sign the contract) · deep roster, so everyone worth over $1 gets drafted
                  </Mono>
                )}
              </View>
            )}
            {step === 'format' && (
              <View>
                <LabelInfo label="FORMAT"
                  info={'How the season is WON.\n\nHEAD-TO-HEAD — weekly matchups, standings, playoffs. The standard game.\n\n🔪 GUILLOTINE — each week the lowest-scoring team is ELIMINATED and its whole roster hits a $1000 FAAB frenzy (preset). The last team standing wins. Bring extra teams — one falls per week.\n\n🧛 VAMPIRE — one team is the Vampire: no waivers or free agents, but when it wins a matchup it STEALS a player from the loser (giving one back). Appoint the seat in ⚑ COMMISH after creating, where you can also require your approval per steal.'} />
                <View style={{ flexDirection: 'row', gap: 5, marginTop: 5, flexWrap: 'wrap' }}>
                  <Chip label="HEAD-TO-HEAD" on={format === 'standard'} onPress={() => { tap(); setFormat('standard'); }} />
                  <Chip label="🔪 GUILLOTINE" on={format === 'guillotine'} onPress={() => { tap(); setFormat('guillotine'); }} />
                  <Chip label="🧛 VAMPIRE" on={format === 'vampire'} onPress={() => { tap(); setFormat('vampire'); }} />
                </View>
              </View>
            )}
            {step === 'name' && (
              <View style={{ gap: 10 }}>
              <TextInput value={nameDraft} maxLength={40} placeholder="League name" placeholderTextColor={t.faint}
                onChangeText={(v) => { setNameDraft(v); setErr(null); }}
                style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 9, fontSize: 14, color: t.text, backgroundColor: t.bg }} />
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <Mono size={8.5} tone="faint" track={0.1}>TEAMS</Mono>
                <Pressable hitSlop={6} onPress={() => { tap(); setTeamCount((n) => Math.max(2, n - 1)); }}>
                  <Text style={{ fontFamily: MONO, fontSize: 16, color: t.dim }}>−</Text>
                </Pressable>
                <Text style={{ fontFamily: MONO, fontSize: 15, fontWeight: '700', color: t.text, minWidth: 26, textAlign: 'center' }}>{teamCount}</Text>
                <Pressable hitSlop={6} onPress={() => { tap(); setTeamCount((n) => Math.min(14, n + 1)); }}>
                  <Text style={{ fontFamily: MONO, fontSize: 16, color: t.dim }}>＋</Text>
                </Pressable>
                <View style={{ flex: 1 }} />
                {/* a contract type already decided the room — auction only */}
                {!contractType && <Chip label="SNAKE" on={draftMode === 'snake'} onPress={() => { tap(); setDraftMode('snake'); }} />}
                <Chip label="AUCTION" on={draftMode === 'auction'} onPress={() => { if (!contractType) { tap(); setDraftMode('auction'); } }} />
              </View>
              </View>
            )}
            {step === 'draft' && (
              <View style={{ gap: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <Mono size={8.5} tone="faint" track={0.1}>PACE</Mono>
                <Chip label="⚡ LIVE" on={pace === 'live'} onPress={() => { tap(); setPace('live'); }} />
                <Chip label="🐢 SLOW" on={pace === 'slow'} onPress={() => { tap(); setPace('slow'); }} />
                <View style={{ flex: 1 }} />
                <Mono size={8.5} tone="faint" track={0.1}>{pace === 'live' ? 'CLOCK (SEC)' : 'CLOCK (HRS)'}</Mono>
                <TextInput value={clockDraft} keyboardType="number-pad" onChangeText={(v) => setClockDraft(v.replace(/\D/g, ''))}
                  style={{ width: 62, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 6, paddingHorizontal: 9, paddingVertical: 6, fontFamily: MONO, fontSize: 13, color: t.text, backgroundColor: t.bg }} />
              </View>
              </View>
            )}
            {/* THE LAST SCREEN IS THE WHOLE ANSWER, because the steps that
                built it are now behind you and the one thing you cannot undo
                is about to happen. */}
            {step === 'review' && (
              <View style={{ gap: 8 }}>
                <Mono size={9} tone="faint" track={0.12}>YOU ARE CREATING</Mono>
                <Display size={16}>{nameDraft.trim() || 'un-named league'}</Display>
                <Mono size={10} tone="dim" style={{ lineHeight: 15 }}>
                  {teamCount} teams · {game === 'classic' ? '🏈 NORMAL' : '◈ DRIP'}
                  {continuity !== 'redraft' ? ` · ${contLabel.trim()}` : ' · REDRAFT'}
                  {format !== 'standard' ? ` · ${format === 'guillotine' ? '🔪 GUILLOTINE' : '🧛 VAMPIRE'}` : ''}
                </Mono>
                <Mono size={10} tone="dim" style={{ lineHeight: 15 }}>
                  {draftMode === 'auction' ? 'AUCTION' : 'SNAKE'} draft · {pace === 'live' ? `${clockDraft || '90'}s a pick` : `${clockDraft || '12'}h a pick`}
                </Mono>
                {copyBp && (
                  <Mono size={9} tone="you" style={{ lineHeight: 14 }}>
                    ⧉ copying {copyFrom?.league?.name ?? 'a league'} — scoring, waivers and the rest are applied right after it is made
                  </Mono>
                )}
              <Mono size={8.5} tone="faint" style={{ lineHeight: 13 }}>
                {game === null
                  ? 'The roster shape follows the game you pick above.'
                  : game === 'classic'
                    ? '15 roster spots per team. Set the starting lineup and scoring from ⚑ COMMISH before the draft.'
                    : '12 roster spots per team: 8 weekly starters, 4 bench. Roster size, position limits and the draft schedule are all adjustable before the draft.'}
                {' '}You take seat 1 as commissioner and a 14-week schedule is generated automatically.
              </Mono>
              {/* The button NAMES the game it will create — the confirmation
                  lives in the moment of commitment, not in a dialog after. */}
              <PrimaryButton
                label={busy ? (makeNote || 'CREATING…')
                  : game === null ? 'PICK A GAME TO CREATE'
                  : game === 'classic' ? '⚡ CREATE 🏈 NORMAL LEAGUE' : '⚡ CREATE ◈ DRIP LEAGUE'}
                disabled={busy || !nameDraft.trim() || !game} onPress={() => void doCreate()} />
              </View>
            )}
          </View>

          {/* NEXT is refused rather than hidden when the step is unanswered,
              and says WHY — a disabled button with no reason is a dead end. */}
          {step !== 'review' && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14 }}>
              <Chip label="← BACK" onPress={() => { tap(); if (stepIx === 0) { setNode('root'); } else setStepIx((i) => i - 1); }} />
              <View style={{ flex: 1 }} />
              {!canNext && (
                <Mono size={8.5} tone="dim">{step === 'game' ? 'pick a game' : 'name it first'}</Mono>
              )}
              <Chip label="NEXT →" on={canNext} dim={!canNext}
                onPress={() => { if (!canNext) { warn(); return; } tap(); setStepIx((i) => Math.min(STEPS.length - 1, i + 1)); }} />
            </View>
          )}
          {step === 'review' && (
            <View style={{ flexDirection: 'row', marginTop: 12 }}>
              <Chip label="← BACK" onPress={() => { tap(); setStepIx((i) => Math.max(0, i - 1)); }} />
            </View>
          )}
        </Card>
      )}

      {/* ── JOIN WITH A CODE ───────────────────────────────────────────── */}
      {node === 'join' && (
        <>
      {/* HAVE A CODE? — the invite path, above the commissioner one because
          it's the common case by a wide margin: most people arriving here were
          handed a code by a friend, not asked to run the league. */}
      <Card>
        <Mono size={9} tone="faint" track={0.12}>GOT AN INVITE CODE?</Mono>
        <Mono size={9.5} style={{ marginTop: 5, lineHeight: 14 }}>
          A friend's league isn't on the board unless they listed it. Paste the code they sent and you're seated.
        </Mono>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
          <TextInput value={inviteDraft} autoCapitalize="characters" autoCorrect={false} maxLength={12}
            placeholder="INVITE CODE" placeholderTextColor={t.faint}
            onChangeText={(v) => { setInviteDraft(v); setErr(null); }}
            style={{ flex: 1, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 8, fontFamily: MONO, fontSize: 13, letterSpacing: 1.5, color: t.text, backgroundColor: t.bg }} />
          <Chip label={busy ? '…' : '→ JOIN'} on disabled={busy || !inviteDraft.trim()} onPress={() => void doJoinByCode()} />
        </View>
        <TextInput value={inviteTeam} maxLength={24} placeholder="team name (optional)" placeholderTextColor={t.faint}
          onChangeText={setInviteTeam}
          style={{ marginTop: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 8, fontSize: 13, color: t.text, backgroundColor: t.bg }} />
        <Mono size={8.5} tone="faint" style={{ marginTop: 6, lineHeight: 13 }}>
          You take the lowest open seat. Leave the name blank and you can set it later from MY TEAM.
        </Mono>
      </Card>

        </>
      )}

      {/* ── POST & RECRUIT ─────────────────────────────────────────────── */}
      {node === 'post' && (
        <>
      {/* POST — the commissioner's own native leagues */}
      {myLeagues.length > 0 && (
        <Card>
          <Mono size={9} tone="faint" track={0.12}>YOUR LEAGUES — POST THEM HERE</Mono>
          {myLeagues.map((l) => {
            const listed = listedIds.has(l.league_id);
            const open = l.rosters - l.enrolled;
            return (
              <View key={l.league_id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd, marginTop: 5 }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ fontSize: 12.5, fontWeight: '700', color: t.text }}>{l.name}</Text>
                  <Mono size={8.5} tone="faint">{open > 0 ? `${open} open seat${open === 1 ? '' : 's'}` : 'full'}{listed ? ' · ON THE BOARD' : ''}</Mono>
                </View>
                <Chip label="⇪ SHARE CODE" onPress={() => void share(l.league_id)} />
                {listed
                  ? <Chip label="UNLIST" onPress={() => { tap(); void unlist(l.league_id); }} />
                  : <Chip label="POST" on onPress={() => {
                      tap(); setPostFor(l); setBlurbDraft(''); setDuesDraft('');
                      // prefill from the standing listing so a re-post doesn't
                      // silently blank the blurb or clear the dues
                      void leagueListingState(l.league_id).then((s) => {
                        if (s.ok) { setBlurbDraft(s.blurb ?? ''); setDuesDraft(s.dues ?? ''); }
                      }).catch(() => {});
                    }} />}
              </View>
            );
          })}
        </Card>
      )}
        </>
      )}

      {/* ── REDEEM A COMMISSIONER CODE ─────────────────────────────────── */}
      {node === 'commish' && (
        <>
      {/* redeem a commish code — the seatless way to run a league */}
      <Card>
        <Mono size={9} tone="faint" track={0.12}>COMMISSIONER?</Mono>
        <Mono size={9.5} style={{ marginTop: 5, lineHeight: 14 }}>
          Redeem a commissioner code to run a league — you don't need a team in it to be its commissioner.
        </Mono>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
          <TextInput value={commishDraft} autoCapitalize="characters" autoCorrect={false} maxLength={12}
            placeholder="COMMISH CODE" placeholderTextColor={t.faint} onChangeText={setCommishDraft}
            style={{ flex: 1, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 8, fontFamily: MONO, fontSize: 13, color: t.text, backgroundColor: t.bg }} />
          <Chip label={busy ? '…' : '⚑ REDEEM'} on disabled={busy || !commishDraft.trim()} onPress={() => void doRedeemCommish()} />
        </View>
      </Card>
        </>
      )}


      {/* review → the whole league before a seat is taken (0156) */}
      <Overlay visible={!!previewFor} title={previewFor?.name ?? ''}
        subtitle={previewFor ? `${previewFor.season} · ${previewFor.seats_open} of ${previewFor.seats_total} seats open` : undefined}
        onClose={() => setPreviewFor(null)}>
        <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 28, gap: 10 }}>
          {preview === null && <Mono size={10} tone="faint">Loading the league…</Mono>}
          {preview !== null && !preview.ok && <Mono size={10} tone="opp">⚠ {friendlyError(preview.error ?? 'could not load')}</Mono>}
          {preview?.ok && (
            <>
              {/* the truth block first (0223): type, money, then the pitch */}
              {!!preview.identity && (
                <Mono size={9} tone="dim" style={{ lineHeight: 14 }}>{identityLine(preview.identity)}</Mono>
              )}
              {!!preview.dues && <Mono size={10} tone="warn" weight="700">💵 DUES: {preview.dues}</Mono>}
              {!!preview.blurb && <Mono size={10.5} style={{ lineHeight: 16 }}>{preview.blurb}</Mono>}
              {preview.contract_rules && (
                <View>
                  <Mono size={8.5} weight="700" track={0.12} tone="faint">📜 CONTRACTS & CAP</Mono>
                  <Mono size={10} style={{ marginTop: 4, lineHeight: 15 }}>
                    ${preview.contract_rules.salary_cap} cap · deals up to {preview.contract_rules.years_max}yr · {preview.contract_rules.dead_pct}% dead money on cuts
                    {'\n'}{[
                      preview.contract_rules.retention ? 'salary retention' : null,
                      preview.contract_rules.cap_trading ? 'cap trading' : null,
                      preview.contract_rules.ir_relief ? 'IR cap relief' : null,
                      preview.contract_rules.rfa ? 'RFA tenders' : null,
                    ].filter(Boolean).join(' · ') || 'no optional mechanics on'}
                    {'\n'}tags at +{preview.contract_rules.tag_raise_pct}% · extensions at {preview.contract_rules.ext_discount_pct}% of market
                  </Mono>
                </View>
              )}
              {preview.draft && (
                <View>
                  <Mono size={8.5} weight="700" track={0.12} tone="faint">⛏ DRAFT</Mono>
                  <Mono size={10} style={{ marginTop: 4, lineHeight: 15 }}>
                    {preview.draft.mode === 'auction' ? `Auction · $${preview.draft.budget ?? 200} budget` : 'Snake'} · {preview.draft.rounds} rounds · {preview.draft.pick_seconds >= 3600 ? `${Math.round(preview.draft.pick_seconds / 3600)}h` : `${preview.draft.pick_seconds}s`} clock
                    {preview.draft.night ? ` · overnight pause ${fmtNightHour(preview.draft.night.start_min)}–${fmtNightHour(preview.draft.night.end_min)} ET` : ''}
                    {'\n'}{preview.draft.status === 'pending' ? 'Draft not started — you would draft with the league.' : preview.draft.status === 'live' ? 'Draft is LIVE right now.' : 'Draft complete — open seats take over existing rosters.'}
                  </Mono>
                </View>
              )}
              {preview.rules && (
                <View>
                  <Mono size={8.5} weight="700" track={0.12} tone="faint">⚖ HOUSE RULES</Mono>
                  <Mono size={10} style={{ marginTop: 4, lineHeight: 15 }}>
                    Game: {preview.game_mode === 'classic'
                      ? `CLASSIC — traditional fantasy, ${preview.ppr === 1 ? 'full PPR' : preview.ppr === 0.5 ? 'half PPR' : 'non-PPR'}, no power-ups${(preview.bestball?.length ?? 0) > 0 ? ((preview.bestball?.length ?? 0) >= 9 ? ', FULL BEST BALL' : `, best ball ×${preview.bestball!.length}`) : ''}${preview.roster && Object.keys(preview.roster).length ? `\nLineup: ${rosterLabel(preview.roster)}` : ''}`
                      : 'DRIP — live metric battles, windows, power-ups'}
                    {'\n'}Waivers: {preview.rules.waiver_mode === 'faab' ? `FAAB · $${preview.rules.faab_budget ?? 100} budget` : 'rolling priority'}
                    {'\n'}Trades: {preview.rules.trade_review === 'commish' ? 'commissioner reviews each trade' : 'execute on accept'}
                    {'\n'}Real-time power-ups: {preview.rules.live_buffs ? 'on' : 'off (commissioner disabled)'}
                    {preview.scoring ? `\nScoring: ${preview.scoring.td_bonus >= 0 ? '+' : ''}${preview.scoring.td_bonus} per TD · ×${preview.scoring.yd_mult} yards · ${preview.scoring.to_penalty} per turnover` : ''}
                  </Mono>
                </View>
              )}
              {!!preview.teams?.length && (
                <View>
                  <Mono size={8.5} weight="700" track={0.12} tone="faint">👥 SEATS</Mono>
                  {preview.teams.map((tm) => (
                    <View key={tm.roster_id} style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
                      <Text style={{ flex: 1, fontSize: 12, color: tm.taken ? t.text : t.faint }}>{tm.team_name}</Text>
                      <Text style={{ fontFamily: MONO, fontSize: 8.5, fontWeight: '700', color: tm.taken ? t.dim : t.you }}>{tm.taken ? 'TAKEN' : 'OPEN'}</Text>
                    </View>
                  ))}
                </View>
              )}
              <View style={{ marginTop: 6 }}>
                <PrimaryButton label="✓ I'M IN — TAKE A SEAT" disabled={busy}
                  onPress={() => { tap(); const r = previewFor!; setPreviewFor(null); setJoinFor(r); setTeamDraft(''); }} />
              </View>
              <Mono size={8.5} tone="faint" style={{ lineHeight: 13 }}>
                Joining takes one of the open seats. Browse freely — nothing is committed until you take one.
              </Mono>
            </>
          )}
        </ScrollView>
      </Overlay>

      {/* join → name your team */}
      <Overlay visible={!!joinFor} title={joinFor ? `Join ${joinFor.name}` : ''}
        subtitle="Pick a team name — you can rename later." onClose={() => setJoinFor(null)}>
        <TextInput value={teamDraft} autoFocus maxLength={40} placeholder="Team name (optional)" placeholderTextColor={t.faint}
          onChangeText={setTeamDraft}
          style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 9, fontSize: 14, color: t.text, backgroundColor: t.bg }} />
        <View style={{ marginTop: 10 }}>
          <PrimaryButton label={busy ? '…' : '✓ TAKE A SEAT'} disabled={busy} onPress={() => void doJoin()} />
        </View>
        <Mono size={8.5} tone="faint" style={{ marginTop: 8, lineHeight: 14 }}>
          You get the next open seat. If the league drafts later, you'll draft with everyone else — check the DRAFT tab once you're in.
        </Mono>
      </Overlay>

      {/* post → write the pitch */}
      <Overlay visible={!!postFor} title={postFor ? `Post ${postFor.name}` : ''}
        subtitle="A sentence on the league — buy-in, style, draft night." onClose={() => setPostFor(null)}>
        <TextInput value={blurbDraft} autoFocus maxLength={280} multiline placeholder="Two seats open, auction draft Sunday 8pm ET…" placeholderTextColor={t.faint}
          onChangeText={setBlurbDraft}
          style={{ minHeight: 70, textAlignVertical: 'top', borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 9, fontSize: 13, color: t.text, backgroundColor: t.bg }} />
        {/* DUES (0223): free text, printed on the card and the preview. The
            platform never touches the money — this is the commissioner's word,
            put where joiners decide. */}
        <Mono size={8.5} tone="faint" track={0.1} style={{ marginTop: 10 }}>DUES (OPTIONAL)</Mono>
        <TextInput value={duesDraft} maxLength={120} placeholder="e.g. $50 — Venmo before the draft" placeholderTextColor={t.faint}
          onChangeText={setDuesDraft}
          style={{ marginTop: 4, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 8, fontSize: 13, color: t.text, backgroundColor: t.bg }} />
        <View style={{ marginTop: 10 }}>
          <PrimaryButton label={busy ? '…' : '⇪ PUT IT ON THE BOARD'} disabled={busy} onPress={() => void doPost()} />
        </View>
        <Mono size={8.5} tone="faint" style={{ marginTop: 8, lineHeight: 14 }}>
          Anyone signed in can browse the board and take a seat. The card carries the league's type, scoring and dues automatically. The listing comes down when you unlist it or the seats fill.
        </Mono>
      </Overlay>
    </ScrollView>
  );
}


/** What kind of league the card advertises (0223), in one printed line:
 *  "◈ DRIP · 📜 CONTRACT ($30 cap) · 🔪 GUILLOTINE · ½ PPR · custom scoring". */
const identityLine = (id?: LeagueIdentity): string => {
  if (!id) return '';
  const bits: string[] = [id.game_mode === 'classic' ? '🏈 NORMAL' : '◈ DRIP'];
  if (id.continuity === 'contract') bits.push(`📜 CONTRACT${id.salary_cap ? ` ($${id.salary_cap} cap)` : ''}`);
  else if (id.continuity === 'contract_dynasty') bits.push(`📜🏰 CONTRACT DYNASTY${id.salary_cap ? ` ($${id.salary_cap} cap)` : ''}`);
  else if (id.continuity === 'dynasty') bits.push('🏰 DYNASTY');
  else if (id.continuity === 'keeper') bits.push('★ KEEPER');
  else bits.push('REDRAFT');
  if (id.format === 'guillotine') bits.push('🔪 GUILLOTINE');
  if (id.format === 'vampire') bits.push('🧛 VAMPIRE');
  if (id.game_mode === 'classic') bits.push(id.ppr === 0 ? 'STANDARD (0 PPR)' : id.ppr === 0.5 ? '½ PPR' : id.ppr === 1 ? 'FULL PPR' : `${id.ppr} PPR`);
  if (id.scoring_custom) bits.push('custom scoring');
  return bits.join(' · ');
};

/** "10p" / "9a" from minutes-since-midnight ET — the preview's night label. */
const fmtNightHour = (m: number) => {
  const h = Math.floor(m / 60) % 24;
  return `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? 'a' : 'p'}`;
};

