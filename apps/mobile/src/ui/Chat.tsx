// Chat (0147), native — the web chat panel as a tab screen.
//
// Same two surfaces (LEAGUE channel, DIRECT threads), same polling contract:
// 8s while a surface is mounted, opening a surface marks it read server-side
// (fetching the latest page IS the read). Deleting your own message — or any
// message, as the commissioner — is a long-press, the phone idiom for "act on
// this thing" (the web shows a ✕; a ✕ per bubble on a phone is clutter).
import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  chatPost, chatMessages, chatDelete, chatMembers, dmSend, dmThreads, dmMessages,
  leagueNote, friendlyError,
  type ChatMessage, type DmThreadRow, type DmMessage,
} from '@drip/core/data/liveApi';
import { useTheme, alpha, MONO } from '../theme.native';
import { tap, commit, warn } from './feedback';
import { Mono } from './prims';

const fmtWhen = (at: string): string => {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  const today = new Date();
  return d.toDateString() === today.toDateString()
    ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

export function ChatScreen({ leagueId }: { leagueId: string }) {
  const t = useTheme();
  const [tab, setTab] = useState<'league' | 'dm'>('league');
  const [canModerate, setCanModerate] = useState(false);
  useEffect(() => { leagueNote(leagueId).then((r) => setCanModerate(!!r.can_edit)).catch(() => {}); }, [leagueId]);
  return (
    <View style={{ flex: 1, paddingHorizontal: 12, paddingTop: 8 }}>
      <View style={{ flexDirection: 'row', gap: 6, marginBottom: 8 }}>
        {(['league', 'dm'] as const).map((id) => (
          <Pressable key={id} onPress={() => { tap(); setTab(id); }}
            style={{ borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5, backgroundColor: tab === id ? alpha(t.you, 14) : t.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: tab === id ? t.you : t.bd }}>
            <Text style={{ fontFamily: MONO, fontSize: 9, fontWeight: '700', color: tab === id ? t.you : t.dim }}>
              {id === 'league' ? '💬 LEAGUE' : '✉ DIRECT'}
            </Text>
          </Pressable>
        ))}
      </View>
      {tab === 'league'
        ? <LeagueChat leagueId={leagueId} canModerate={canModerate} />
        : <DmHome leagueId={leagueId} />}
    </View>
  );
}

/** Scroll body pinned to the newest message unless the reader scrolled up. */
function useStickyScroll() {
  const ref = useRef<ScrollView>(null);
  const stick = useRef(true);
  const onScroll = (e: { nativeEvent: { contentOffset: { y: number }; contentSize: { height: number }; layoutMeasurement: { height: number } } }) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    stick.current = contentSize.height - contentOffset.y - layoutMeasurement.height < 80;
  };
  const onContentSizeChange = () => { if (stick.current) ref.current?.scrollToEnd({ animated: false }); };
  return { ref, onScroll, onContentSizeChange };
}

function Composer({ draft, setDraft, busy, err, onSend, placeholder }: {
  draft: string; setDraft: (v: string) => void; busy: boolean; err: string | null; onSend: () => void; placeholder: string;
}) {
  const t = useTheme();
  return (
    <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd, paddingTop: 8, paddingBottom: 10 }}>
      {!!err && <Mono size={9.5} tone="opp" style={{ marginBottom: 6 }}>{err}</Mono>}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <TextInput value={draft} maxLength={500} onChangeText={setDraft} onSubmitEditing={onSend}
          placeholder={placeholder} placeholderTextColor={t.faint} returnKeyType="send"
          style={{ flex: 1, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 8, paddingHorizontal: 11, paddingVertical: 8, fontSize: 13, color: t.text, backgroundColor: t.bg }} />
        <Pressable disabled={busy || !draft.trim()} onPress={() => { tap(); onSend(); }}
          style={{ backgroundColor: t.you, borderRadius: 8, paddingHorizontal: 14, justifyContent: 'center', opacity: busy || !draft.trim() ? 0.5 : 1 }}>
          <Text style={{ fontSize: 14, color: t.onAccent }}>➤</Text>
        </Pressable>
      </View>
    </View>
  );
}

function LeagueChat({ leagueId, canModerate }: { leagueId: string; canModerate: boolean }) {
  const t = useTheme();
  const [msgs, setMsgs] = useState<ChatMessage[] | null>(null);
  const [draft, setDraft] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sticky = useStickyScroll();
  const load = () => chatMessages(leagueId)
    .then((r) => { if (r.ok && r.messages) setMsgs([...r.messages].reverse()); })
    .catch(() => {});
  useEffect(() => {
    void load();
    const id = setInterval(load, 8_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId]);
  const send = async () => {
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await chatPost(leagueId, body);
      if (!r.ok) { warn(); setErr(friendlyError(r.error ?? 'Could not send.')); return; }
      commit(); setDraft(''); await load();
    } catch (x) { warn(); setErr(friendlyError(x)); }
    finally { setBusy(false); }
  };
  const del = (m: ChatMessage) => {
    if (!m.mine && !canModerate) return;
    Alert.alert('Delete message?', `“${m.body.slice(0, 80)}”`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => {
          chatDelete(leagueId, m.id).then((r) => { if (r.ok) { commit(); void load(); } else { warn(); setErr(friendlyError(r.error ?? '')); } }).catch(() => warn());
        } },
    ]);
  };
  return (
    <View style={{ flex: 1 }}>
      <ScrollView ref={sticky.ref} onScroll={sticky.onScroll} onContentSizeChange={sticky.onContentSizeChange}
        scrollEventThrottle={64} style={{ flex: 1 }}>
        {msgs == null && <Mono size={10} tone="faint">Loading…</Mono>}
        {msgs?.length === 0 && <Mono size={10} tone="faint">Nothing yet — say hello to the league.</Mono>}
        {msgs?.map((m) => (
          <Pressable key={m.id} onLongPress={() => del(m)} delayLongPress={350} style={{ marginBottom: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
              <Text style={{ fontFamily: MONO, fontSize: 9, fontWeight: '700', color: m.mine ? t.you : t.warn }}>{m.author}</Text>
              <Text style={{ fontFamily: MONO, fontSize: 8, color: t.faint }}>{fmtWhen(m.at)}</Text>
            </View>
            <Text style={{ fontSize: 13, lineHeight: 18, color: t.text }}>{m.body}</Text>
          </Pressable>
        ))}
        <View style={{ height: 6 }} />
      </ScrollView>
      <Composer draft={draft} setDraft={setDraft} busy={busy} err={err} onSend={() => void send()} placeholder="message the league…" />
    </View>
  );
}

function DmHome({ leagueId }: { leagueId: string }) {
  const t = useTheme();
  const [openThread, setOpenThread] = useState<{ threadId: string | null; peerId: string; peer: string } | null>(null);
  const [threads, setThreads] = useState<DmThreadRow[] | null>(null);
  const [pick, setPick] = useState(false);
  const [members, setMembers] = useState<{ id: string; name: string; me: boolean }[] | null>(null);
  const load = () => dmThreads(leagueId).then((r) => { if (r.ok && r.threads) setThreads(r.threads); }).catch(() => {});
  useEffect(() => {
    if (openThread) return;
    void load();
    const id = setInterval(load, 15_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId, openThread]);
  useEffect(() => {
    if (pick && members == null) chatMembers(leagueId).then((r) => { if (r.ok && r.members) setMembers(r.members); }).catch(() => {});
  }, [pick, members, leagueId]);

  if (openThread) {
    return <DmThreadView leagueId={leagueId} thread={openThread}
      onBack={() => { setOpenThread(null); void load(); }}
      onThreadId={(tid) => setOpenThread((cur) => (cur ? { ...cur, threadId: tid } : cur))} />;
  }
  return (
    <View style={{ flex: 1 }}>
      <ScrollView style={{ flex: 1 }}>
        {pick ? (
          <>
            <Mono size={9} tone="faint" track={0.12}>MESSAGE WHO?</Mono>
            {members == null && <Mono size={10} tone="faint" style={{ marginTop: 6 }}>Loading…</Mono>}
            {members?.filter((m) => !m.me).map((m) => (
              <Pressable key={m.id} onPress={() => { tap(); setPick(false); setOpenThread({ threadId: null, peerId: m.id, peer: m.name }); }}
                style={{ paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.bd }}>
                <Text style={{ fontSize: 13, color: t.text }}>{m.name}</Text>
              </Pressable>
            ))}
            <Pressable hitSlop={6} onPress={() => { tap(); setPick(false); }} style={{ marginTop: 10 }}>
              <Text style={{ fontFamily: MONO, fontSize: 10, fontWeight: '700', color: t.dim }}>← back</Text>
            </Pressable>
          </>
        ) : (
          <>
            {threads == null && <Mono size={10} tone="faint">Loading…</Mono>}
            {threads?.length === 0 && <Mono size={10} tone="faint">No conversations yet.</Mono>}
            {threads?.map((th) => (
              <Pressable key={th.thread_id} onPress={() => { tap(); setOpenThread({ threadId: th.thread_id, peerId: th.peer_id, peer: th.peer }); }}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.bd }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ fontSize: 13, fontWeight: th.unread > 0 ? '700' : '400', color: t.text }}>{th.peer}</Text>
                  {!!th.preview && <Text numberOfLines={1} style={{ fontFamily: MONO, fontSize: 9.5, color: t.faint }}>{th.preview}</Text>}
                </View>
                <Text style={{ fontFamily: MONO, fontSize: 8, color: t.faint }}>{fmtWhen(th.last_at)}</Text>
                {th.unread > 0 && (
                  <View style={{ backgroundColor: t.you, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2 }}>
                    <Text style={{ fontFamily: MONO, fontSize: 8.5, fontWeight: '700', color: t.onAccent }}>{th.unread}</Text>
                  </View>
                )}
              </Pressable>
            ))}
          </>
        )}
      </ScrollView>
      {!pick && (
        <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd, paddingTop: 8, paddingBottom: 10 }}>
          <Pressable onPress={() => { tap(); setPick(true); }}
            style={{ backgroundColor: t.you, borderRadius: 8, paddingVertical: 10, alignItems: 'center' }}>
            <Text style={{ fontFamily: MONO, fontSize: 10, fontWeight: '700', color: t.onAccent }}>＋ NEW MESSAGE</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

function DmThreadView({ leagueId, thread, onBack, onThreadId }: {
  leagueId: string;
  thread: { threadId: string | null; peerId: string; peer: string };
  onBack: () => void;
  onThreadId: (tid: string) => void;
}) {
  const t = useTheme();
  const [msgs, setMsgs] = useState<DmMessage[] | null>(thread.threadId ? null : []);
  const [draft, setDraft] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sticky = useStickyScroll();
  const load = (tid: string) => dmMessages(tid)
    .then((r) => { if (r.ok && r.messages) setMsgs([...r.messages].reverse()); })
    .catch(() => {});
  useEffect(() => {
    if (!thread.threadId) return;
    void load(thread.threadId);
    const id = setInterval(() => { if (thread.threadId) void load(thread.threadId); }, 8_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread.threadId]);
  const send = async () => {
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await dmSend(leagueId, thread.peerId, body);
      if (!r.ok) { warn(); setErr(friendlyError(r.error ?? 'Could not send.')); return; }
      commit(); setDraft('');
      if (r.thread_id) { if (!thread.threadId) onThreadId(r.thread_id); await load(r.thread_id); }
    } catch (x) { warn(); setErr(friendlyError(x)); }
    finally { setBusy(false); }
  };
  return (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingBottom: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.bd }}>
        <Pressable hitSlop={8} onPress={() => { tap(); onBack(); }}>
          <Text style={{ fontFamily: MONO, fontSize: 12, fontWeight: '700', color: t.dim }}>←</Text>
        </Pressable>
        <Text style={{ fontSize: 13, fontWeight: '700', color: t.text }}>{thread.peer}</Text>
      </View>
      <ScrollView ref={sticky.ref} onScroll={sticky.onScroll} onContentSizeChange={sticky.onContentSizeChange}
        scrollEventThrottle={64} style={{ flex: 1, paddingTop: 8 }}>
        {msgs == null && <Mono size={10} tone="faint">Loading…</Mono>}
        {msgs?.length === 0 && <Mono size={10} tone="faint">Say hello.</Mono>}
        {msgs?.map((m) => (
          <View key={m.id} style={{ flexDirection: 'row', justifyContent: m.mine ? 'flex-end' : 'flex-start', marginBottom: 8 }}>
            <View style={{ maxWidth: '78%', borderRadius: 12, paddingHorizontal: 11, paddingVertical: 7, backgroundColor: m.mine ? alpha(t.you, 18) : t.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd }}>
              <Text style={{ fontSize: 13, lineHeight: 18, color: t.text }}>{m.body}</Text>
              <Text style={{ fontFamily: MONO, fontSize: 7.5, color: t.faint, marginTop: 2, textAlign: m.mine ? 'right' : 'left' }}>{fmtWhen(m.at)}</Text>
            </View>
          </View>
        ))}
        <View style={{ height: 6 }} />
      </ScrollView>
      <Composer draft={draft} setDraft={setDraft} busy={busy} err={err} onSend={() => void send()} placeholder={`message ${thread.peer}…`} />
    </View>
  );
}
