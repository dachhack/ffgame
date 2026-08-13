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
  closeLeagueListing, commishOverview, friendlyError, joinFromBoard, leagueBoard, leagueInvite,
  postLeagueListing, type AdminLeague, type BoardListing,
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
  const [teamDraft, setTeamDraft] = useState('');
  const [postFor, setPostFor] = useState<AdminLeague | null>(null);
  const [blurbDraft, setBlurbDraft] = useState('');
  const [joined, setJoined] = useState<string | null>(null); // league name, for the success note

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
      else { commit(); setJoined(target.name); onJoined(); }
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
                <PrimaryButton label="JOIN THIS LEAGUE" disabled={busy}
                  onPress={() => { tap(); setJoinFor(r); setTeamDraft(''); }} />
              </View>
            )}
          </View>
        </Card>
      ))}

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
