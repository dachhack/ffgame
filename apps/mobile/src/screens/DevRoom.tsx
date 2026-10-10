// THE DEV ROOM, native (v0.658.0, 0459) — the web twin's note
// (src/screens/DevRoom.tsx): a chat that belongs to no league, joined by an
// admin's invite code, where a message tagged 💡 idea or 🐞 bug is filed as a
// public GitHub issue (no names) by the worker and comes back with its number.
//
// Reached from the gear (everyone: a tester types their code there) and from
// the leagues list (members and admins, with the unread count).
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, Share, Text, TextInput, View } from 'react-native';
import {
  devRoomsMine, devRoomCreate, devRoomJoin, devRoomMessages, devRoomPost, devRoomTag, devRoomDelete,
  devRoomMembers, devRoomRemove, devRoomInviteCreate, devRoomInvites, devRoomInviteRevoke, friendlyError,
  type DevRoom, type DevMessage, type DevMember, type DevInvite, type DevTag,
} from '@drip/core/data/liveApi';
import { devRoomInviteMessage, cleanDevCode, issueUrl, TAG_LABEL } from '@drip/core/data/devRoom';
import { useTheme } from '../theme.native';
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
  const [code, setCode] = useState('');
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
      <Card style={{ gap: 8 }}>
        <Mono size={9} tone="faint" weight="700" track={0.1}>HAVE AN INVITE CODE?</Mono>
        <Mono size={9} tone="faint">The dev room is invite-only. Enter the code you were sent.</Mono>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <Field value={code} onChangeText={setCode} placeholder="ABCD1234" autoCapitalize="characters" autoCorrect={false} style={{ flex: 1 }} />
          <Chip label="JOIN" on disabled={busy || cleanDevCode(code).length < 8} onPress={() => { tap(); void run(() => devRoomJoin(cleanDevCode(code))); }} />
        </View>
      </Card>
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

function People({ roomId, roomName, onLeft }: { roomId: string; roomName: string; onLeft: () => void }) {
  const [members, setMembers] = useState<DevMember[]>([]);
  const [admin, setAdmin] = useState(false);
  const [invites, setInvites] = useState<DevInvite[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await devRoomMembers(roomId);
    if (!r.ok) { setErr(r.error ?? 'Couldn’t read the members.'); return; }
    setMembers(r.members ?? []); setAdmin(!!r.admin);
    if (r.admin) { const i = await devRoomInvites(roomId); if (i.ok) setInvites(i.invites ?? []); }
  }, [roomId]);
  useEffect(() => { void load().catch((e) => setErr(friendlyError(e))); }, [load]);
  const act = async (p: Promise<{ ok: boolean; error?: string }>) => {
    const r = await p.catch((e) => ({ ok: false, error: friendlyError(e) }));
    if (!r.ok) setErr(r.error ?? 'That didn’t work.'); else { setErr(null); await load(); }
    return r.ok;
  };
  const share = async (code: string) => {
    try { await Share.share({ message: devRoomInviteMessage({ room: roomName, code }) }); } catch (e) { setErr(friendlyError(e)); }
  };
  const confirm = (title: string, verb: string, go: () => void) =>
    Alert.alert(title, undefined, [{ text: 'Cancel', style: 'cancel' }, { text: verb, style: 'destructive', onPress: go }]);
  const me = members.find((m) => m.me);
  return (
    <ScrollView contentContainerStyle={{ padding: 12, gap: 10, paddingBottom: 60 }}>
      {err && <Mono size={10} tone="warn">{err}</Mono>}
      {admin && (
        <Card style={{ gap: 8 }}>
          <Mono size={9} tone="faint" weight="700" track={0.1}>INVITE PEOPLE</Mono>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <Chip label="＋ ONE-PERSON CODE" on onPress={() => { tap(); void act(devRoomInviteCreate(roomId, 1)); }} />
            <Chip label="＋ REUSABLE CODE" onPress={() => { tap(); void act(devRoomInviteCreate(roomId, null)); }} />
          </View>
          {invites.map((i) => (
            <View key={i.code} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', paddingTop: 6 }}>
              <Mono size={12} weight="700" track={0.1} tone="text">{i.code}</Mono>
              <Mono size={8.5} tone="faint" style={{ flex: 1 }}>{i.max_uses == null ? `used ${i.uses}× · reusable` : `${i.uses}/${i.max_uses} used`}</Mono>
              <Chip small label="SHARE" onPress={() => { tap(); void share(i.code); }} />
              <Chip small dim label="REVOKE" onPress={() => { tap(); confirm(`Revoke ${i.code}?`, 'Revoke', () => void act(devRoomInviteRevoke(i.code))); }} />
            </View>
          ))}
        </Card>
      )}
      <Card style={{ gap: 8 }}>
        <Mono size={9} tone="faint" weight="700" track={0.1}>{`MEMBERS (${members.length})`}</Mono>
        {members.map((m) => (
          <View key={m.user_id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Display size={13} style={{ flex: 1 }}>{`${m.name}${m.me ? ' (you)' : ''}`}</Display>
            {m.role === 'admin' && <Mono size={8.5} tone="you">ADMIN</Mono>}
            {admin && !m.me && (
              <Chip small dim label="REMOVE" onPress={() => { tap(); confirm(`Remove ${m.name}?`, 'Remove', () => void act(devRoomRemove(roomId, m.user_id))); }} />
            )}
          </View>
        ))}
      </Card>
      {me && (
        <Chip dim label="LEAVE THE ROOM" onPress={() => { tap(); confirm('Leave the dev room? You’ll need a new invite to come back.', 'Leave', async () => { if (await act(devRoomRemove(roomId, me.user_id))) onLeft(); }); }} />
      )}
    </ScrollView>
  );
}
