// THE DEV ROOM, native (v0.658.0, 0459) — the web twin's note
// (src/screens/DevRoom.tsx): a chat that belongs to no league, joined by an
// admin's invite code, where a message tagged 💡 idea or 🐞 bug is filed as a
// public GitHub issue (no names) by the worker and comes back with its number.
//
// Reached from the gear (everyone: a tester types their code there) and from
// the leagues list (members and admins, with the unread count).
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import {
  devRoomsMine, devRoomCreate, devRoomMessages, devRoomPost, devRoomTag, devRoomDelete,
  devRoomMembers, devRoomRemove, devRoomSetOpen, devRoomUsers, devRoomSetMember, friendlyError,
  type DevRoom, type DevMessage, type DevMember, type DevTag, type DevUser,
} from '@drip/core/data/liveApi';
import { issueUrl, TAG_LABEL } from '@drip/core/data/devRoom';
import { useTheme } from '../theme.native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { tap } from '../ui/feedback';
import { Card, Chip, Display, Mono } from '../ui/prims';

const POLL_MS = 5000;
const fmtAt = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };

/** The leagues list's door: a member of any room, or an admin. */
export function DevRoomBanner({ onOpen }: { onOpen: (roomId: string | null) => void }) {
  const t = useTheme();
  const [rooms, setRooms] = useState<DevRoom[] | null>(null);
  const [canCreate, setCanCreate] = useState(false);
  useEffect(() => {
    let alive = true;
    devRoomsMine().then((r) => { if (alive && r.ok) { setRooms(r.rooms ?? []); setCanCreate(!!r.can_create); } }).catch(() => {});
    return () => { alive = false; };
  }, []);
  if (!rooms || (!rooms.length && !canCreate)) return null;
  const unread = rooms.reduce((n, r) => n + r.unread, 0);
  return (
    <Pressable onPress={() => { tap(); onOpen(rooms.length === 1 ? rooms[0].id : null); }} accessibilityRole="button"
      style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: t.bd, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: t.surface }}>
      <Mono size={10.5} tone="you" weight="700" track={0.08}>🛠 DEV ROOM</Mono>
      <Mono size={9} tone="faint" numberOfLines={1} style={{ flex: 1 }}>{rooms.length ? rooms.map((r) => r.name).join(' · ') : 'make one and invite testers'}</Mono>
      {unread > 0 && <Mono size={9} weight="700" style={{ color: t.bg, backgroundColor: t.you, borderRadius: 9, paddingHorizontal: 7, paddingVertical: 1, overflow: 'hidden' }}>{unread}</Mono>}
    </Pressable>
  );
}

/** THE CHIP (v0.662.0) — the web twin's note: "a floating chip pinned to the
 *  bottom left". It floats over the leagues list; tap it and the room rises
 *  in a panel above it, ⤢ opens the full room. Absolute inside the shell's
 *  leagues view, so it never covers a league's own room bar. */
export function DevRoomBar({ onOpenFull }: { onOpenFull: (roomId: string | null) => void }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [rooms, setRooms] = useState<DevRoom[] | null>(null);
  const [canCreate, setCanCreate] = useState(false);
  const [open, setOpen] = useState(false);
  const read = useCallback(() => devRoomsMine().then((r) => { if (r.ok) { setRooms(r.rooms ?? []); setCanCreate(!!r.can_create); } }).catch(() => {}), []);
  useEffect(() => { void read(); const iv = setInterval(() => { void read(); }, 30_000); return () => clearInterval(iv); }, [read]);
  if (!rooms || (!rooms.length && !canCreate)) return null;
  const unread = rooms.reduce((n, r) => n + r.unread, 0);
  const bottom = 14 + insets.bottom;
  return (
    <>
      {open && rooms.length > 0 && (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ position: 'absolute', left: 10, right: 10, bottom: bottom + 52, height: 460, zIndex: 20,
            backgroundColor: t.surface, borderWidth: 1, borderColor: t.bd, borderRadius: 14, paddingTop: 10, overflow: 'hidden',
            shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingBottom: 6 }}>
            <Mono size={10.5} tone="you" weight="700" track={0.08} style={{ flex: 1 }}>{`🛠 ${rooms.length === 1 ? rooms[0].name.toUpperCase() : 'DEV ROOM'}`}</Mono>
            <Chip small label="⤢" a11y="Open the full room" onPress={() => { tap(); setOpen(false); onOpenFull(rooms.length === 1 ? rooms[0].id : null); }} />
            <Chip small label="✕" a11y="Close" onPress={() => { tap(); setOpen(false); void read(); }} />
          </View>
          <DevRoomPanel rooms={rooms} />
        </KeyboardAvoidingView>
      )}
      <Pressable accessibilityRole="button" accessibilityLabel="Dev room"
        onPress={() => { tap(); if (!rooms.length) { onOpenFull(null); return; } setOpen((o) => !o); if (open) void read(); }}
        style={{ position: 'absolute', left: 14, bottom, zIndex: 21, flexDirection: 'row', alignItems: 'center', gap: 6,
          backgroundColor: open ? t.you : t.surface, borderWidth: 1, borderColor: t.you, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9,
          shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 8 }}>
        <Mono size={11} weight="700" track={0.06} style={{ color: open ? t.bg : t.you }}>{rooms.length ? '🛠 DEV' : '🛠 DEV ROOM'}</Mono>
        {unread > 0 && !open && <Mono size={9} weight="700" style={{ color: t.bg, backgroundColor: t.you, borderRadius: 9, paddingHorizontal: 6, paddingVertical: 1, overflow: 'hidden' }}>{String(unread)}</Mono>}
      </Pressable>
    </>
  );
}

/** The room in place: the bar's panel and league chat's 🛠 DEV chip. */
export function DevRoomPanel({ rooms }: { rooms: DevRoom[] }) {
  const [roomId, setRoomId] = useState<string | null>(rooms[0]?.id ?? null);
  if (!roomId) return <Mono size={10} tone="faint" style={{ padding: 12 }}>You’re not in a dev room.</Mono>;
  return (
    <View style={{ flex: 1 }}>
      {rooms.length > 1 && (
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', paddingHorizontal: 12, paddingBottom: 6 }}>
          {rooms.map((r) => <Chip key={r.id} small on={r.id === roomId} label={`${r.name}${r.unread ? ` · ${r.unread}` : ''}`} onPress={() => { tap(); setRoomId(r.id); }} />)}
        </View>
      )}
      <Room key={roomId} roomId={roomId} onLeft={() => setRoomId(null)} />
    </View>
  );
}

/** Rooms I'm in (an open room joins me on this read) — for the chat chip. */
export function useDevRooms(): DevRoom[] {
  const [rooms, setRooms] = useState<DevRoom[]>([]);
  useEffect(() => { let alive = true; devRoomsMine().then((r) => { if (alive && r.ok) setRooms(r.rooms ?? []); }).catch(() => {}); return () => { alive = false; }; }, []);
  return rooms;
}

export function DevRoomScreen({ roomId: initial, onBack }: { roomId: string | null; onBack: () => void }) {
  const t = useTheme();
  const [roomId, setRoomId] = useState<string | null>(initial);
  const inRoomFromList = !!roomId && !initial;
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: t.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 6 }}>
        <Chip label={inRoomFromList ? '← ROOMS' : '← BACK'} onPress={() => { tap(); if (inRoomFromList) setRoomId(null); else onBack(); }} />
        <Mono size={11} tone="you" weight="700" track={0.1}>🛠 DEV ROOM</Mono>
      </View>
      {roomId ? <Room roomId={roomId} onLeft={() => setRoomId(null)} /> : <RoomList onPick={setRoomId} />}
    </KeyboardAvoidingView>
  );
}

function Field(props: React.ComponentProps<typeof TextInput>) {
  const t = useTheme();
  return <TextInput placeholderTextColor={t.faint} {...props}
    style={[{ color: t.text, borderWidth: 1, borderColor: t.bd, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14, backgroundColor: t.bg }, props.style]} />;
}

function RoomList({ onPick }: { onPick: (id: string) => void }) {
  const [rooms, setRooms] = useState<DevRoom[]>([]);
  const [canCreate, setCanCreate] = useState(false);
  const [name, setName] = useState('Drip Dev');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    devRoomsMine().then((r) => { if (r.ok) { setRooms(r.rooms ?? []); setCanCreate(!!r.can_create); } }).catch(() => {});
  }, []);
  const run = async (p: () => Promise<{ ok: boolean; error?: string; room_id?: string }>) => {
    setBusy(true); setErr(null);
    try { const r = await p(); if (r.ok && r.room_id) onPick(r.room_id); else setErr(r.error ?? 'That didn’t work.'); }
    catch (e) { setErr(friendlyError(e)); } finally { setBusy(false); }
  };
  return (
    <ScrollView contentContainerStyle={{ padding: 12, gap: 10, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
      {rooms.map((r) => (
        <Pressable key={r.id} onPress={() => { tap(); onPick(r.id); }}>
          <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Display size={15}>{r.name}</Display>
            <Mono size={9} tone="faint" style={{ flex: 1 }}>{`${r.members} member${r.members === 1 ? '' : 's'}${r.role === 'admin' ? ' · admin' : ''}`}</Mono>
            {r.unread > 0 && <Mono size={9} tone="you" weight="700">{`${r.unread} new`}</Mono>}
          </Card>
        </Pressable>
      ))}
      {!rooms.length && !canCreate && <Mono size={10} tone="faint">The dev room is by invitation: an admin switches you on.</Mono>}
      {canCreate && (
        <Card style={{ gap: 8 }}>
          <Mono size={9} tone="faint" weight="700" track={0.1}>MAKE A ROOM (ADMIN)</Mono>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <Field value={name} onChangeText={setName} maxLength={60} style={{ flex: 1 }} />
            <Chip label="MAKE IT" on disabled={busy} onPress={() => { tap(); void run(() => devRoomCreate(name)); }} />
          </View>
        </Card>
      )}
      {err && <Mono size={10} tone="warn">{err}</Mono>}
    </ScrollView>
  );
}

function Room({ roomId, onLeft }: { roomId: string; onLeft: () => void }) {
  const t = useTheme();
  const [tab, setTab] = useState<'chat' | 'people'>('chat');
  const [name, setName] = useState('');
  const [msgs, setMsgs] = useState<DevMessage[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [tag, setTag] = useState<DevTag | null>(null);
  const [busy, setBusy] = useState(false);
  const [admin, setAdmin] = useState(false);
  const scroller = useRef<ScrollView | null>(null);

  const load = useCallback(async () => {
    const r = await devRoomMessages(roomId);
    if (!r.ok) { setErr(r.error ?? 'Couldn’t read the room.'); return; }
    setErr(null); setName(r.name ?? ''); setMsgs([...(r.messages ?? [])].reverse());
  }, [roomId]);
  useEffect(() => {
    void load().catch((e) => setErr(friendlyError(e)));
    devRoomMembers(roomId).then((r) => { if (r.ok) setAdmin(!!r.admin); }).catch(() => {});
    const iv = setInterval(() => { void load().catch(() => {}); }, POLL_MS);
    return () => clearInterval(iv);
  }, [load, roomId]);

  const send = async () => {
    if (!draft.trim() || busy) return;
    setBusy(true);
    try {
      const r = await devRoomPost(roomId, draft, tag);
      if (!r.ok) { setErr(r.error ?? 'Didn’t send.'); return; }
      setDraft(''); setTag(null); await load();
    } catch (e) { setErr(friendlyError(e)); } finally { setBusy(false); }
  };
  const retag = async (m: DevMessage, next: DevTag | null) => {
    const r = await devRoomTag(m.id, next).catch((e) => ({ ok: false, error: friendlyError(e) }));
    if (!r.ok) setErr(r.error ?? 'Couldn’t tag it.'); else await load();
  };
  const del = (m: DevMessage) => Alert.alert('Delete this message?', undefined, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: async () => {
      const r = await devRoomDelete(m.id).catch((e) => ({ ok: false, error: friendlyError(e) }));
      if (!r.ok) setErr(r.error ?? 'Couldn’t delete it.'); else await load();
    } },
  ]);

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingBottom: 6 }}>
        <Display size={17} style={{ flex: 1 }}>{name}</Display>
        <Chip small label="CHAT" on={tab === 'chat'} onPress={() => { tap(); setTab('chat'); }} />
        <Chip small label={admin ? 'PEOPLE & INVITES' : 'PEOPLE'} on={tab === 'people'} onPress={() => { tap(); setTab('people'); }} />
      </View>
      {err && <Mono size={10} tone="warn" style={{ paddingHorizontal: 12 }}>{err}</Mono>}
      {tab === 'people' ? <People roomId={roomId} roomName={name} onLeft={onLeft} /> : (
        <>
          <ScrollView ref={scroller} style={{ flex: 1 }} contentContainerStyle={{ padding: 12, gap: 12 }}
            onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: false })}>
            {!msgs.length && <Mono size={10} tone="faint">Nothing yet. Say what you’d change — tag it 💡 or 🐞 to log it.</Mono>}
            {msgs.map((m) => {
              const open = !m.issue && !m.filing;
              const canTag = open && (m.mine || admin);
              return (
                <View key={m.id} style={{ gap: 3 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <Mono size={9} weight="700" tone={m.mine ? 'you' : 'dim'}>{m.mine ? 'you' : m.author}</Mono>
                    <Mono size={8.5} tone="faint">{fmtAt(m.at)}</Mono>
                    {m.tag && <Mono size={8.5} weight="700" tone={m.tag === 'bug' ? 'warn' : 'you'}>{TAG_LABEL[m.tag]}</Mono>}
                    {m.issue ? (
                      <Pressable hitSlop={6} onPress={() => { tap(); void Linking.openURL(issueUrl(m.issue!)); }}>
                        <Mono size={8.5} tone="you">{`logged #${m.issue} ↗`}</Mono>
                      </Pressable>
                    ) : m.tag ? <Mono size={8.5} tone="faint">{m.filing ? 'logging…' : 'queued to log'}</Mono> : null}
                  </View>
                  <Text selectable style={{ fontSize: 14, lineHeight: 20, color: t.text }}>{m.body}</Text>
                  {(canTag || m.mine || admin) && (
                    <View style={{ flexDirection: 'row', gap: 14 }}>
                      {canTag && (['idea', 'bug'] as const).map((k) => (
                        <Pressable key={k} hitSlop={6} onPress={() => { tap(); void retag(m, m.tag === k ? null : k); }}>
                          <Mono size={8.5} tone={m.tag === k ? 'you' : 'faint'}>{m.tag === k ? `✓ ${TAG_LABEL[k]}` : `tag ${TAG_LABEL[k]}`}</Mono>
                        </Pressable>
                      ))}
                      {(m.mine || admin) && (
                        <Pressable hitSlop={6} onPress={() => { tap(); del(m); }}><Mono size={8.5} tone="faint">delete</Mono></Pressable>
                      )}
                    </View>
                  )}
                </View>
              );
            })}
          </ScrollView>
          <View style={{ borderTopWidth: 1, borderTopColor: t.bd, padding: 10, gap: 8, backgroundColor: t.surface }}>
            <Field value={draft} onChangeText={setDraft} maxLength={1000} multiline placeholder="A suggestion, a bug, a thought…" style={{ maxHeight: 120 }} />
            <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
              <Chip small label="JUST CHAT" on={tag === null} onPress={() => { tap(); setTag(null); }} />
              <Chip small label={TAG_LABEL.idea} on={tag === 'idea'} onPress={() => { tap(); setTag('idea'); }} />
              <Chip small label={TAG_LABEL.bug} on={tag === 'bug'} onPress={() => { tap(); setTag('bug'); }} />
              <View style={{ flex: 1 }} />
              <Chip label="SEND" on disabled={busy || !draft.trim()} onPress={() => { tap(); void send(); }} />
            </View>
            {/* THE PUBLIC LINE, where the tag is chosen (see the web twin). */}
            <Mono size={8.5} tone="faint">
              {tag ? 'Tagged messages are logged as public GitHub issues (your name isn’t included).' : 'Tag a message 💡 or 🐞 to log it as a public GitHub issue (no names).'}
            </Mono>
          </View>
        </>
      )}
    </View>
  );
}

function People({ roomId, onLeft }: { roomId: string; roomName: string; onLeft: () => void }) {
  const [members, setMembers] = useState<DevMember[]>([]);
  const [admin, setAdmin] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await devRoomMembers(roomId);
    if (!r.ok) { setErr(r.error ?? 'Couldn’t read the members.'); return; }
    setMembers(r.members ?? []); setAdmin(!!r.admin);
  }, [roomId]);
  useEffect(() => { void load().catch((e) => setErr(friendlyError(e))); }, [load]);
  const act = async (p: Promise<{ ok: boolean; error?: string }>) => {
    const r = await p.catch((e) => ({ ok: false, error: friendlyError(e) }));
    if (!r.ok) setErr(r.error ?? 'That didn’t work.'); else { setErr(null); await load(); }
    return r.ok;
  };
  const confirm = (title: string, verb: string, go: () => void) =>
    Alert.alert(title, undefined, [{ text: 'Cancel', style: 'cancel' }, { text: verb, style: 'destructive', onPress: go }]);
  const me = members.find((m) => m.me);
  // OPEN TO EVERYONE (0463).
  const [openAll, setOpenAll] = useState<boolean | null>(null);
  useEffect(() => { devRoomsMine().then((r) => { if (r.ok) setOpenAll(!!r.rooms?.find((x) => x.id === roomId)?.open); }).catch(() => {}); }, [roomId]);
  const setOpen = async (on: boolean) => { if (await act(devRoomSetOpen(roomId, on))) setOpenAll(on); };
  return (
    <ScrollView contentContainerStyle={{ padding: 12, gap: 10, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
      {err && <Mono size={10} tone="warn">{err}</Mono>}
      {admin && openAll !== null && (
        <Card style={{ gap: 8 }}>
          <Mono size={9} tone="faint" weight="700" track={0.1}>WHO’S IN</Mono>
          <Mono size={10} tone="dim">{openAll ? 'Everyone signed in — anyone you take out stays out.' : 'Only the people you switch on below.'}</Mono>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Chip small label="PICKED" on={!openAll} onPress={() => { tap(); void setOpen(false); }} />
            <Chip small label="EVERYONE" on={openAll} onPress={() => { tap(); confirm('Open this room to every signed-in player? Tagged lines become public GitHub issues.', 'Open it', () => void setOpen(true)); }} />
          </View>
        </Card>
      )}
      {admin ? <Roster roomId={roomId} onChanged={() => void load()} /> : (
        <Card style={{ gap: 8 }}>
          <Mono size={9} tone="faint" weight="700" track={0.1}>{`MEMBERS (${members.length})`}</Mono>
          {members.map((m) => (
            <View key={m.user_id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Display size={13} style={{ flex: 1 }}>{`${m.name}${m.me ? ' (you)' : ''}`}</Display>
              {m.role === 'admin' && <Mono size={8.5} tone="you">ADMIN</Mono>}
            </View>
          ))}
        </Card>
      )}
      {me && !admin && (
        <Chip dim label="LEAVE THE ROOM" onPress={() => { tap(); confirm('Leave the dev room? An admin can add you back.', 'Leave', async () => { if (await act(devRoomRemove(roomId, me.user_id))) onLeft(); }); }} />
      )}
    </ScrollView>
  );
}

/** THE ROSTER (v0.662.0) — the web twin's note: every registered account, a
 *  switch each; the only way into the room. */
function Roster({ roomId, onChanged }: { roomId: string; onChanged: () => void }) {
  const t = useTheme();
  const [users, setUsers] = useState<DevUser[] | null>(null);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async (search: string) => {
    const r = await devRoomUsers(roomId, search);
    if (!r.ok) { setErr(r.error ?? 'Couldn’t read the accounts.'); return; }
    setErr(null); setUsers(r.users ?? []); setTotal(r.total ?? 0);
  }, [roomId]);
  useEffect(() => { const h = setTimeout(() => { void load(q).catch((e) => setErr(friendlyError(e))); }, 250); return () => clearTimeout(h); }, [load, q]);
  const flip = async (u: DevUser) => {
    setBusy(u.user_id);
    const r = await devRoomSetMember(roomId, u.user_id, !u.in).catch((e) => ({ ok: false, error: friendlyError(e) }));
    setBusy(null);
    if (!r.ok) { setErr(r.error ?? 'That didn’t work.'); return; }
    setUsers((list) => (list ?? []).map((x) => (x.user_id === u.user_id ? { ...x, in: !u.in } : x)));
    onChanged();
  };
  const inCount = (users ?? []).filter((u) => u.in).length;
  return (
    <Card style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
        <Mono size={9} tone="faint" weight="700" track={0.1} style={{ flex: 1 }}>REGISTERED PLAYERS</Mono>
        <Mono size={9} tone="faint">{`${inCount} in · ${total} accounts`}</Mono>
      </View>
      <Field value={q} onChangeText={setQ} placeholder="Search a name or email…" autoCapitalize="none" autoCorrect={false} />
      {err && <Mono size={10} tone="warn">{err}</Mono>}
      {!users && <Mono size={9} tone="faint">Loading…</Mono>}
      {(users ?? []).map((u) => (
        <View key={u.user_id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, borderTopWidth: 1, borderTopColor: t.bd, paddingTop: 7 }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ fontSize: 14, color: t.text, fontWeight: u.in ? '700' : '400' }}>{`${u.name}${u.me ? ' (you)' : ''}${u.role === 'admin' ? ' · admin' : ''}`}</Text>
            {!!u.email && <Mono size={8.5} tone="faint" numberOfLines={1}>{u.email}</Mono>}
          </View>
          <Chip small on={u.in} disabled={busy === u.user_id || (u.me && u.in)} label={u.in ? 'IN' : 'OUT'} onPress={() => { tap(); void flip(u); }} />
        </View>
      ))}
    </Card>
  );
}
