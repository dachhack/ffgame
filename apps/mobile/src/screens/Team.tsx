// Team management for native leagues — roster, free agency, waivers, FAAB.
//
// Port of the web TeamManage (src/screens/NativeLeague.tsx). Same self-driving
// rule: process_waivers runs on load (idempotent), so due claims clear even
// with no worker awake. Same gates, same order of decisions: waived player →
// claim (FAAB leagues collect the blind bid first), free agent → instant add,
// roster full → pick a drop before either.
//
// Deliberately not ported (both exist on the web, use them there for now):
//   · TradeCenter — propose/answer/commish-review is a screen of its own; the
//     waiver/FAAB path is what a phone needs on a Tuesday night.
//   · AvatarPicker — the web's art grid; renaming is here, art can wait.
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  addFreeAgent, cancelWaiverClaim, dropPlayer, friendlyError, leagueInvite, leaguePool, nativeRosters,
  nativeTeamState, processWaivers, setTeamName, submitWaiverClaim, POS_CAP_KEYS,
  type LeaguePoolPlayer, type NativeTeamState,
} from '@drip/core/data/liveApi';
import { headshot } from '@drip/core/data/media';
import { useTheme, MONO } from '../theme.native';
import { tap, commit, warn } from '../ui/feedback';
import { Card, Chip, Display, LinkButton, Mono, Notice, PosPill, PrimaryButton } from '../ui/prims';
import { Overlay } from '../ui/Overlay';
import { CommishSettings } from '../ui/CommishSettings';

const POS_FILTERS = ['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'DEF'] as const;

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

export function Team({ leagueId, onBack, onDraft }: { leagueId: string; onBack: () => void; onDraft: () => void }) {
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
  const settingsSheet = team.is_commish ? (
    <CommishSettings visible={settingsOpen} leagueId={leagueId}
      onClose={() => setSettingsOpen(false)} onSaved={() => void refresh()} />
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
        <Mono size={8.5} tone="faint" style={{ marginTop: 6 }}>Trades live on the web app for now.</Mono>
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
