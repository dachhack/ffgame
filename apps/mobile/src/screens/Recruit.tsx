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
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, RefreshControl, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  closeLeagueListing, commishOverview, friendlyError, joinFromBoard, leagueBoard, leagueInvite, leaguePreview, type BoardPreview,
  postLeagueListing, redeemCommish, type AdminLeague, type BoardListing,
} from '@drip/core/data/liveApi';
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
                      ? `CLASSIC — traditional fantasy, ${preview.ppr === 1 ? 'full PPR' : preview.ppr === 0.5 ? 'half PPR' : 'non-PPR'}, no power-ups${(preview.bestball?.length ?? 0) === 9 ? ', FULL BEST BALL' : (preview.bestball?.length ?? 0) > 0 ? `, best ball ×${preview.bestball!.length}` : ''}`
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
