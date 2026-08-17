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
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, RefreshControl, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  closeLeagueListing, commishOverview, friendlyError, joinFromBoard, leagueBoard, leagueInvite, leaguePreview, type BoardPreview,
  postLeagueListing, redeemCommish, nativeJoin, createNativeLeague, seedLeaguePool,
  nativeGenerateSchedule, myFeatures, isAdmin, type AdminLeague, type BoardListing,
} from '@drip/core/data/liveApi';
import { rosterLabel } from '@drip/core/engine/classic';
import { buildDraftPool } from '@drip/core/data/nativeLeague';
import { useTheme, MONO } from '../theme.native';
import { tap, commit, warn } from '../ui/feedback';
import { Card, Chip, Display, LinkButton, Mono, Notice, PrimaryButton } from '../ui/prims';
import { Overlay } from '../ui/Overlay';

/** League crest with an initial fallback (same reasoning as Leagues.Crest). */
function Crest({ url, name, size = 40 }: { url?: string | null; name?: string | null; size?: number }) {
  const t = useTheme();
  const [failed, setFailed] = useState(false);
  const show = url && !failed;
  return (
    <View style={{ width: size, height: size, borderRadius: Math.round(size * 0.19), overflow: 'hidden', flexShrink: 0, backgroundColor: t.bg, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, alignItems: 'center', justifyContent: 'center' }}>
      {show
        ? <Image source={{ uri: url }} onError={() => setFailed(true)} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
        : <Text style={{ fontFamily: MONO, fontSize: Math.round(size * 0.42), fontWeight: '700', color: t.faint }}>{(name ?? '?').trim().charAt(0).toUpperCase() || '?'}</Text>}
    </View>
  );
}

export function Recruit({ onBack, onJoined }: {
  onBack: () => void;
  /** A join succeeded — the leagues list needs a reload. */
  onJoined: () => void;
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
  const [joined, setJoined] = useState<string | null>(null); // league name, for the success note
  const [commishDraft, setCommishDraft] = useState('');      // commish-code redemption
  const [inviteDraft, setInviteDraft] = useState('');        // invite-code join (native_join)
  const [inviteTeam, setInviteTeam] = useState('');
  // Create-a-league (v0.226.0). The form is the web's post-v0.221.0 trim:
  // only what has NO setter after creation gets asked here — game type, name,
  // teams, draft type, pace, clock. Roster size and position limits are
  // defaults the game type picks, adjustable from ⚑ COMMISH until the draft.
  const [canCreate, setCanCreate] = useState(false);
  const [makeOpen, setMakeOpen] = useState(false);
  // NO DEFAULT (v0.251.0) — same rule as the web. This used to start on
  // 'drip', and a commissioner who never tapped 🏈 NORMAL got a drip league
  // with a normie name; the choice freezes at the draft, so the mistake is
  // permanent. The form refuses to submit until the game is chosen.
  const [game, setGame] = useState<'drip' | 'classic' | null>(null);
  // DYNASTY (0184): an identity on top of either game, not a third game.
  const [dynasty, setDynasty] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [teamCount, setTeamCount] = useState(8);
  const [draftMode, setDraftMode] = useState<'snake' | 'auction'>('snake');
  const [pace, setPace] = useState<'live' | 'slow'>('live');
  const [clockDraft, setClockDraft] = useState('90');
  const [makeNote, setMakeNote] = useState('');

  const load = useCallback(async () => {
    setErr(null);
    try {
      const [b, cl] = await Promise.all([
        leagueBoard(),
        // The commissioner's own leagues feed the POST section. Only native
        // ones can be listed (the board's promise is a claimable seat).
        commishOverview().then((ls) => ls.filter((l) => l.provider === 'native')).catch(() => [] as AdminLeague[]),
      ]);
      setRows(b); setMyLeagues(cl);
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
      const r = await postLeagueListing(postFor.league_id, blurbDraft.trim() || null);
      if (!r.ok) { warn(); setErr(friendlyError(r.error ?? 'could not post')); } else commit();
    } catch (e) { warn(); setErr(friendlyError(e)); }
    finally { setBusy(false); setPostFor(null); setBlurbDraft(''); await load(); }
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
        setJoined(r.league ?? 'your league');
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
  const doCreate = async () => {
    const nm = nameDraft.trim();
    if (!nm || busy || !game) return;
    // The busy note NAMES the game — the last chance to notice a wrong tap
    // before it freezes at the draft.
    setBusy(true); setErr(null); setMakeNote(`Creating your ${dynasty ? '🏰 DYNASTY ' : ''}${game === 'classic' ? 'NORMAL' : 'DRIP'} league…`);
    try {
      const secs = pace === 'slow' ? Math.max(1, Number(clockDraft) || 12) * 3600 : Math.max(15, Number(clockDraft) || 90);
      // Same defaults the web derives from the game type (v0.221.0): drip
      // keeps the pre-0071 position limits, classic takes none because its
      // shape is the starting-lineup spec.
      const rounds = game === 'classic' ? 15 : 12;
      const caps = game === 'classic' ? null : { QB: 3, RB: null, WR: null, TE: 3, K: 1, DEF: 1 };
      const r = await createNativeLeague(nm, '2026', teamCount, rounds, secs, draftMode, 200, 15, 1, null, null, caps, game, dynasty);
      if (!r.ok || !r.league_id) { warn(); setErr(friendlyError(r.error ?? 'could not create the league')); return; }
      setMakeNote('Building the 2026 player pool…');
      const pool = await seedLeaguePool(r.league_id, await buildDraftPool(setMakeNote));
      if (!pool.ok) { warn(); setErr(friendlyError(pool.error ?? 'league created, but the player pool failed — reseed it from the draft room')); return; }
      setMakeNote('Generating the season schedule…');
      const sched = await nativeGenerateSchedule(r.league_id, 14);
      if (!sched.ok) { warn(); setErr(friendlyError(sched.error ?? 'league created, but the schedule failed — regenerate it from ⚑ COMMISH')); return; }
      commit();
      // The success note names the game too — created is the moment a wrong
      // mode is cheapest to notice.
      setJoined(`${nm}, a ${dynasty ? '🏰 DYNASTY ' : ''}${game === 'classic' ? '🏈 NORMAL' : '◈ DRIP'} league — you're its commissioner`);
      setMakeOpen(false); setNameDraft('');
    } catch (e) { warn(); setErr(friendlyError(e)); }
    finally { setBusy(false); setMakeNote(''); onJoined(); await load(); }
  };

  const share = async (leagueId: string) => {
    tap();
    try {
      const r = await leagueInvite(leagueId);
      if (!r.ok || !r.invite_code) { warn(); setErr(friendlyError(r.error ?? 'could not fetch the invite code')); return; }
      await Share.share({
        message: `Join my league "${r.name}" on Drip Fantasy — real-time fantasy football. ` +
          `Invite code: ${r.invite_code}${r.seats_open ? ` (${r.seats_open} seat${r.seats_open === 1 ? '' : 's'} open)` : ''}. dripfantasy.com`,
      });
    } catch { /* sheet dismissed */ }
  };

  if (rows === null) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 }}>
        <ActivityIndicator color={t.you} />
        <Mono size={9.5} tone="faint">Loading the league board…</Mono>
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: t.bg }} contentContainerStyle={{ padding: 12, paddingBottom: 40, gap: 10 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={t.you} />}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View>
          <Display size={20}>League board</Display>
          <Mono size={9.5} tone="faint">Open leagues looking for managers.</Mono>
        </View>
        <View style={{ flex: 1 }} />
        <LinkButton label="← back" onPress={onBack} />
      </View>

      {!!err && <Notice tone="opp"><Mono size={10} tone="opp">{err}</Mono></Notice>}
      {!!joined && (
        <Notice tone="you">
          <Mono size={10} tone="you">✓ You're in {joined} — it's on your leagues screen now.</Mono>
        </Notice>
      )}

      {/* START A LEAGUE (v0.226.0) — the last thing the app couldn't do.
          Gated on the same `native` entitlement the web button uses, so the
          card doesn't advertise a door the server would shut. */}
      {canCreate && (
        <Card>
          <Pressable onPress={() => { tap(); setMakeOpen((v) => !v); }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={{ flex: 1 }}>
                <Mono size={9} tone="faint" track={0.12}>START YOUR OWN LEAGUE</Mono>
                <Mono size={9.5} style={{ marginTop: 5, lineHeight: 14 }}>
                  Create it here, invite friends, draft in the app. No Sleeper / ESPN / Yahoo league required.
                </Mono>
              </View>
              <Mono size={12} tone="dim">{makeOpen ? '▾' : '▸'}</Mono>
            </View>
          </Pressable>
          {makeOpen && (
            <View style={{ marginTop: 10, gap: 10 }}>
              {/* Same first question as the web (0175): the one choice that
                  changes what you're playing rather than how it's set up. */}
              <View>
                <Mono size={8.5} tone="faint" track={0.1}>WHICH GAME?</Mono>
                <View style={{ flexDirection: 'row', gap: 5, marginTop: 5 }}>
                  <Chip label="◈ DRIP" on={game === 'drip'} onPress={() => { tap(); setGame('drip'); }} />
                  <Chip label="🏈 NORMAL" on={game === 'classic'} onPress={() => { tap(); setGame('classic'); }} />
                </View>
                <Mono size={8.5} tone="faint" style={{ marginTop: 5, lineHeight: 12 }}>
                  {game === null
                    ? 'Pick one — this is the choice that decides what your league plays, and it locks in at the draft.'
                    : game === 'drip'
                      ? 'Drip: your 8 starters play head-to-head in real time as the games run — drips, nukes and power-ups on live play-by-play.'
                      : 'Normal: fantasy the way you already know it. A positional starting lineup, weekly point totals, standard scoring you can tune.'}
                </Mono>
                {/* DYNASTY (0184): presets keepers + a 3-round rookie draft +
                    tradeable picks; everything stays editable in 🔁 NEXT SEASON. */}
                <Pressable onPress={() => { tap(); setDynasty((v) => !v); }}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 8 }}>
                  <View style={{ width: 14, height: 14, borderRadius: 3, borderWidth: 1.5, borderColor: dynasty ? t.you : t.bd, backgroundColor: dynasty ? t.you : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                    {dynasty && <Text style={{ fontSize: 9, color: t.onAccent, fontWeight: '700' }}>✓</Text>}
                  </View>
                  <Mono size={9.5} style={{ flex: 1 }}>🏰 DYNASTY — rosters carry over season to season</Mono>
                </Pressable>
                {dynasty && (
                  <Mono size={8.5} tone="faint" style={{ marginTop: 4, lineHeight: 12 }}>
                    Each team keeps most of its roster into next season and drafts rookies in a 3-round rookie draft — every future pick a tradeable asset from day one. Adjustable any time in 🔁 NEXT SEASON.
                  </Mono>
                )}
              </View>
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
                <Chip label="SNAKE" on={draftMode === 'snake'} onPress={() => { tap(); setDraftMode('snake'); }} />
                <Chip label="AUCTION" on={draftMode === 'auction'} onPress={() => { tap(); setDraftMode('auction'); }} />
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <Mono size={8.5} tone="faint" track={0.1}>PACE</Mono>
                <Chip label="⚡ LIVE" on={pace === 'live'} onPress={() => { tap(); setPace('live'); }} />
                <Chip label="🐢 SLOW" on={pace === 'slow'} onPress={() => { tap(); setPace('slow'); }} />
                <View style={{ flex: 1 }} />
                <Mono size={8.5} tone="faint" track={0.1}>{pace === 'live' ? 'CLOCK (SEC)' : 'CLOCK (HRS)'}</Mono>
                <TextInput value={clockDraft} keyboardType="number-pad" onChangeText={(v) => setClockDraft(v.replace(/\D/g, ''))}
                  style={{ width: 62, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 6, paddingHorizontal: 9, paddingVertical: 6, fontFamily: MONO, fontSize: 13, color: t.text, backgroundColor: t.bg }} />
              </View>
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
        </Card>
      )}

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
                  : <Chip label="POST" on onPress={() => { tap(); setPostFor(l); setBlurbDraft(''); }} />}
              </View>
            );
          })}
        </Card>
      )}

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

      {/* review → the whole league before a seat is taken (0156) */}
      <Overlay visible={!!previewFor} title={previewFor?.name ?? ''}
        subtitle={previewFor ? `${previewFor.season} · ${previewFor.seats_open} of ${previewFor.seats_total} seats open` : undefined}
        onClose={() => setPreviewFor(null)}>
        <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 28, gap: 10 }}>
          {preview === null && <Mono size={10} tone="faint">Loading the league…</Mono>}
          {preview !== null && !preview.ok && <Mono size={10} tone="opp">⚠ {friendlyError(preview.error ?? 'could not load')}</Mono>}
          {preview?.ok && (
            <>
              {!!preview.blurb && <Mono size={10.5} style={{ lineHeight: 16 }}>{preview.blurb}</Mono>}
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
        <View style={{ marginTop: 10 }}>
          <PrimaryButton label={busy ? '…' : '⇪ PUT IT ON THE BOARD'} disabled={busy} onPress={() => void doPost()} />
        </View>
        <Mono size={8.5} tone="faint" style={{ marginTop: 8, lineHeight: 14 }}>
          Anyone signed in can browse the board and take a seat. The listing comes down when you unlist it or the seats fill.
        </Mono>
      </Overlay>
    </ScrollView>
  );
}


/** "10p" / "9a" from minutes-since-midnight ET — the preview's night label. */
const fmtNightHour = (m: number) => {
  const h = Math.floor(m / 60) % 24;
  return `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? 'a' : 'p'}`;
};
