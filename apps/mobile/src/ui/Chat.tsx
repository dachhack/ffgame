// Chat (0147), native — the web chat panel as a tab screen.
//
// Same two surfaces (LEAGUE channel, DIRECT threads), same polling contract:
// 8s while a surface is mounted, opening a surface marks it read server-side
// (fetching the latest page IS the read). Deleting your own message — or any
// message, as the commissioner — is a long-press, the phone idiom for "act on
// this thing" (the web shows a ✕; a ✕ per bubble on a phone is clutter).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  chatPost, chatMessages, chatDelete, chatMembers, dmSend, dmThreads, dmMessages,
  chatPostPoll, pollCast, chatPin,
  leagueNote, friendlyError,
  type ChatMessage, type DmThreadRow, type DmMessage,
} from '@drip/core/data/liveApi';
import { gifProvider, type GifResult } from '@drip/core/data/gifs';
import { Ev, track } from '@drip/core/analytics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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

// ── chat v2 (0148): inline media, @mentions, polls, pins ────────────────────

/** Only these hosts (or bare image files) render inline — anything else stays text. */
const isImageUrl = (s: string): boolean => {
  const t = s.trim();
  if (!/^https?:\/\/\S+$/.test(t)) return false;
  return /^(https?:\/\/)(media\d*\.tenor\.com|media\d*\.giphy\.com|i\.giphy\.com|i\.imgur\.com)\//i.test(t)
    || /\.(gif|png|jpe?g|webp)(\?\S*)?$/i.test(t);
};
const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** GIF search provider (0182.4): Tenor if EXPO_PUBLIC_TENOR_KEY is set, else
 *  Giphy via EXPO_PUBLIC_GIPHY_KEY; with neither the button hides (pasted GIF
 *  links still render inline). */
const GIF = gifProvider(process.env.EXPO_PUBLIC_TENOR_KEY || undefined, process.env.EXPO_PUBLIC_GIPHY_KEY || undefined);

/** A message body: whole-URL images render inline; @TeamName tokens highlight
 *  against the league's real member names (longest name wins). */
/** An inline chat image at its TRUE aspect ratio. The fixed 200×150 cover
 *  box cropped every non-4:3 GIF (the founder's Napoleon lost his head) —
 *  measure the image, keep the width, and give it the height it asks for,
 *  clamped so a tall GIF can't take the whole screen. */
function InlineImage({ uri }: { uri: string }) {
  const t = useTheme();
  const [ar, setAr] = useState(4 / 3);
  useEffect(() => {
    let dead = false;
    Image.getSize(uri, (w, h) => { if (!dead && w > 0 && h > 0) setAr(w / h); }, () => {});
    return () => { dead = true; };
  }, [uri]);
  return <Image source={{ uri }} resizeMode="cover"
    style={{ width: 200, height: Math.round(Math.max(100, Math.min(300, 200 / ar))), borderRadius: 8, marginTop: 2, backgroundColor: t.sh }} />;
}

function MsgBody({ body, names, size = 13 }: { body: string; names: string[]; size?: number }) {
  const t = useTheme();
  if (isImageUrl(body)) return <InlineImage uri={body.trim()} />;
  const base = { fontSize: size, lineHeight: size + 5, color: t.text } as const;
  if (!names.length || !body.includes('@')) return <Text style={base}>{body}</Text>;
  const re = new RegExp(`@(${[...names].sort((a, b) => b.length - a.length).map(escRe).join('|')})`, 'g');
  const parts: ReactNode[] = [];
  let last = 0; let mm: RegExpExecArray | null; let k = 0;
  while ((mm = re.exec(body))) {
    if (mm.index > last) parts.push(body.slice(last, mm.index));
    parts.push(<Text key={k++} style={{ color: t.you, fontWeight: '700' }}>{mm[0]}</Text>);
    last = mm.index + mm[0].length;
  }
  if (last < body.length) parts.push(body.slice(last));
  return <Text style={base}>{parts}</Text>;
}

/** A poll message's options — tap to vote, tap another to change. */
function PollView({ m, leagueId, onVoted }: { m: ChatMessage; leagueId: string; onVoted: () => void }) {
  const t = useTheme();
  const p = m.poll;
  if (!p) return null;
  const total = p.total || 0;
  return (
    <View style={{ marginTop: 4, maxWidth: 320 }}>
      {p.options.map((o, i) => {
        const on = p.mine === i;
        const pct = total ? o.votes / total : 0;
        return (
          <Pressable key={i} onPress={() => { tap(); void pollCast(leagueId, m.id, i).then(onVoted).catch(() => {}); }}
            style={{ marginTop: 4, borderRadius: 7, borderWidth: StyleSheet.hairlineWidth, borderColor: on ? t.you : t.bd, backgroundColor: t.bg, overflow: 'hidden' }}>
            <View style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: `${Math.round(pct * 100)}%`, backgroundColor: alpha(t.you, 14) }} />
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 9, paddingVertical: 7 }}>
              <Text style={{ flex: 1, fontSize: 12.5, color: t.text, fontWeight: on ? '700' : '400' }}>{on ? '● ' : ''}{o.text}</Text>
              <Text style={{ fontFamily: MONO, fontSize: 9, color: t.dim }}>{o.votes}</Text>
            </View>
          </Pressable>
        );
      })}
      <Text style={{ fontFamily: MONO, fontSize: 8.5, color: t.faint, marginTop: 3 }}>📊 {total} vote{total === 1 ? '' : 's'} · tap to vote or change</Text>
    </View>
  );
}

function GifPicker({ onPick, onClose }: { onPick: (url: string) => void; onClose: () => void }) {
  const t = useTheme();
  const [q, setQ] = useState('');
  const [gifs, setGifs] = useState<GifResult[] | null>(null);
  useEffect(() => {
    if (!GIF) return;
    const id = setTimeout(() => {
      GIF.search(q).then(setGifs).catch(() => setGifs([]));
    }, 300);
    return () => clearTimeout(id);
  }, [q]);
  return (
    <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd, paddingTop: 8, maxHeight: 230 }}>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <TextInput value={q} autoFocus onChangeText={setQ} placeholder="search GIFs…" placeholderTextColor={t.faint}
          style={{ flex: 1, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 7, paddingHorizontal: 9, paddingVertical: 6, fontSize: 12, color: t.text, backgroundColor: t.bg }} />
        <Pressable hitSlop={8} onPress={() => { tap(); onClose(); }}>
          <Text style={{ fontSize: 14, color: t.dim }}>✕</Text>
        </Pressable>
      </View>
      <ScrollView style={{ marginTop: 8, flexGrow: 0 }} nestedScrollEnabled>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {gifs == null && <Mono size={9} tone="faint">Loading…</Mono>}
          {gifs?.length === 0 && <Mono size={9} tone="faint">Nothing found.</Mono>}
          {gifs?.map((g) => (
            <Pressable key={g.id} onPress={() => { tap(); onPick(g.full); }}>
              <Image source={{ uri: g.tiny }} style={{ width: 104, height: 74, borderRadius: 6, backgroundColor: t.sh }} resizeMode="cover" />
            </Pressable>
          ))}
        </View>
        <Text style={{ fontFamily: MONO, fontSize: 7.5, color: t.faint, marginTop: 6, marginBottom: 8 }}>{GIF?.attribution}</Text>
      </ScrollView>
    </View>
  );
}

/** The commissioner's poll form: a question and 2–6 options. */
function PollComposer({ leagueId, onDone, onClose }: { leagueId: string; onDone: () => void; onClose: () => void }) {
  const t = useTheme();
  const [q, setQ] = useState('');
  const [opts, setOpts] = useState<string[]>(['', '']);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const filled = opts.filter((o) => o.trim()).length;
  const post = async () => {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await chatPostPoll(leagueId, q.trim(), opts.map((o) => o.trim()).filter(Boolean));
      if (!r.ok) { warn(); setErr(friendlyError(r.error ?? 'Could not post the poll.')); return; }
      commit(); onDone();
    } catch (x) { warn(); setErr(friendlyError(x)); }
    finally { setBusy(false); }
  };
  const field = (v: string, set: (s: string) => void, ph: string, max: number, fs: number) => (
    <TextInput value={v} maxLength={max} onChangeText={set} placeholder={ph} placeholderTextColor={t.faint}
      style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 7, paddingHorizontal: 9, paddingVertical: 6, fontSize: fs, color: t.text, backgroundColor: t.bg, marginTop: 5 }} />
  );
  return (
    <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd, paddingTop: 8 }}>
      <Mono size={9} tone="faint" track={0.12}>📊 NEW POLL</Mono>
      {field(q, setQ, 'the question…', 500, 12.5)}
      {opts.map((o, i) => (
        <View key={i}>{field(o, (v) => setOpts(opts.map((x, j) => (j === i ? v : x))), `option ${i + 1}`, 60, 12)}</View>
      ))}
      {!!err && <Mono size={9.5} tone="opp" style={{ marginTop: 6 }}>{err}</Mono>}
      <View style={{ flexDirection: 'row', gap: 12, marginTop: 8, alignItems: 'center', paddingBottom: 10 }}>
        {opts.length < 6 && (
          <Pressable hitSlop={6} onPress={() => { tap(); setOpts([...opts, '']); }}>
            <Text style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: '700', color: t.dim }}>＋ OPTION</Text>
          </Pressable>
        )}
        <View style={{ flex: 1 }} />
        <Pressable hitSlop={6} onPress={() => { tap(); onClose(); }}>
          <Text style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: '700', color: t.dim }}>CANCEL</Text>
        </Pressable>
        <Pressable disabled={busy || !q.trim() || filled < 2} onPress={() => void post()}
          style={{ backgroundColor: t.you, borderRadius: 7, paddingHorizontal: 12, paddingVertical: 7, opacity: busy || !q.trim() || filled < 2 ? 0.5 : 1 }}>
          <Text style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: '700', color: t.onAccent }}>POST POLL</Text>
        </Pressable>
      </View>
    </View>
  );
}

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
  // App.tsx's SafeAreaView leaves the bottom edge open (the power-up hand owns
  // it), so every bottom-pinned composer must clear the gesture bar itself.
  const insets = useSafeAreaInsets();
  return (
    <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd, paddingTop: 8, paddingBottom: 10 + insets.bottom }}>
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
  const insets = useSafeAreaInsets();
  const [msgs, setMsgs] = useState<ChatMessage[] | null>(null);
  const [pins, setPins] = useState<ChatMessage[]>([]);
  const [pinsOpen, setPinsOpen] = useState(false);
  const [members, setMembers] = useState<{ id: string; name: string; me: boolean }[]>([]);
  const [draft, setDraft] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pollOpen, setPollOpen] = useState(false);
  const [gifOpen, setGifOpen] = useState(false);
  const sticky = useStickyScroll();
  const load = () => chatMessages(leagueId)
    .then((r) => { if (r.ok && r.messages) { setMsgs([...r.messages].reverse()); setPins(r.pins ?? []); } })
    .catch(() => {});
  useEffect(() => { track(Ev.chatOpened, { dm: false }); }, [leagueId]);
  useEffect(() => {
    void load();
    chatMembers(leagueId).then((r) => { if (r.ok && r.members) setMembers(r.members); }).catch(() => {});
    const id = setInterval(load, 8_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId]);
  const names = members.map((m) => m.name);
  const sendBody = async (body: string) => {
    if (!body || busy) return;
    setBusy(true); setErr(null);
    try {
      // mentions travel as ids, derived from the @names still present at send
      const mentions = members.filter((m) => !m.me && body.includes(`@${m.name}`)).map((m) => m.id);
      const r = await chatPost(leagueId, body, mentions);
      if (!r.ok) { warn(); setErr(friendlyError(r.error ?? 'Could not send.')); return; }
      commit(); setDraft(''); setGifOpen(false); await load();
    } catch (x) { warn(); setErr(friendlyError(x)); }
    finally { setBusy(false); }
  };
  const pinToggle = (m: ChatMessage) =>
    chatPin(leagueId, m.id, !m.pinned)
      .then((r) => { if (r.ok) { commit(); void load(); } else { warn(); setErr(friendlyError(r.error ?? '')); } })
      .catch(() => warn());
  const menu = (m: ChatMessage) => {
    const buttons: { text: string; style?: 'cancel' | 'destructive'; onPress?: () => void }[] = [];
    if (canModerate) buttons.push({ text: m.pinned ? '📌 Unpin' : '📌 Pin', onPress: () => void pinToggle(m) });
    if (m.mine || canModerate) buttons.push({
      text: 'Delete', style: 'destructive',
      onPress: () => {
        chatDelete(leagueId, m.id).then((r) => { if (r.ok) { commit(); void load(); } else { warn(); setErr(friendlyError(r.error ?? '')); } }).catch(() => warn());
      },
    });
    if (!buttons.length) return;
    buttons.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert(m.author, m.kind === 'poll' ? `📊 ${m.body.slice(0, 80)}` : m.body.slice(0, 80), buttons);
  };

  // @-autocomplete over the tail of the draft: an @ opening a word, with
  // whatever follows as the query (team names may contain spaces).
  const at = draft.lastIndexOf('@');
  const mq = at >= 0 && (at === 0 || /\s/.test(draft[at - 1])) ? draft.slice(at + 1) : null;
  const sugg = mq != null && mq.length <= 24 && !mq.includes('@')
    ? members.filter((m) => !m.me && m.name.toLowerCase().startsWith(mq.toLowerCase()) && m.name.toLowerCase() !== mq.toLowerCase().trim()).slice(0, 5)
    : [];

  return (
    <View style={{ flex: 1 }}>
      {pins.length > 0 && (
        <View style={{ borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: t.warn, backgroundColor: alpha(t.warn, 7), paddingHorizontal: 10, paddingVertical: 6, marginBottom: 8 }}>
          <Pressable hitSlop={6} onPress={() => { tap(); setPinsOpen((v) => !v); }}>
            <Text style={{ fontFamily: MONO, fontSize: 9, fontWeight: '700', color: t.warn }}>📌 {pins.length} PINNED {pinsOpen ? '▾' : '▸'}</Text>
          </Pressable>
          {pinsOpen && pins.map((p) => (
            <Pressable key={p.id} onLongPress={() => menu(p)} delayLongPress={350}
              style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 5 }}>
              <Text style={{ fontFamily: MONO, fontSize: 8.5, fontWeight: '700', color: t.dim }}>{p.author}</Text>
              <Text numberOfLines={1} style={{ flex: 1, fontSize: 12, color: t.text }}>
                {p.kind === 'poll' ? `📊 ${p.body}` : isImageUrl(p.body) ? '🖼 GIF' : p.body}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
      <ScrollView ref={sticky.ref} onScroll={sticky.onScroll} onContentSizeChange={sticky.onContentSizeChange}
        scrollEventThrottle={64} style={{ flex: 1 }}>
        {msgs == null && <Mono size={10} tone="faint">Loading…</Mono>}
        {msgs?.length === 0 && <Mono size={10} tone="faint">Nothing yet — say hello to the league.</Mono>}
        {msgs?.map((m) => (
          <Pressable key={m.id} onLongPress={() => menu(m)} delayLongPress={350}
            style={{ marginBottom: 10, ...(m.mentions_me ? { backgroundColor: alpha(t.you, 8), borderRadius: 8, paddingHorizontal: 6, paddingVertical: 4, marginHorizontal: -6 } : {}) }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
              <Text style={{ fontFamily: MONO, fontSize: 9, fontWeight: '700', color: m.mine ? t.you : t.warn }}>{m.author}</Text>
              <Text style={{ fontFamily: MONO, fontSize: 8, color: t.faint }}>{fmtWhen(m.at)}</Text>
              {m.pinned && <Text style={{ fontSize: 8 }}>📌</Text>}
            </View>
            {m.kind === 'poll'
              ? <>
                  <Text style={{ fontSize: 13, lineHeight: 18, fontWeight: '700', color: t.text }}>📊 {m.body}</Text>
                  <PollView m={m} leagueId={leagueId} onVoted={() => void load()} />
                </>
              : <MsgBody body={m.body} names={names} />}
          </Pressable>
        ))}
        <View style={{ height: 6 }} />
      </ScrollView>
      {pollOpen && <PollComposer leagueId={leagueId} onDone={() => { setPollOpen(false); void load(); }} onClose={() => setPollOpen(false)} />}
      {gifOpen && !!GIF && <GifPicker onPick={(url) => void sendBody(url)} onClose={() => setGifOpen(false)} />}
      <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd, paddingTop: 8, paddingBottom: 10 + insets.bottom }}>
        {!!err && <Mono size={9.5} tone="opp" style={{ marginBottom: 6 }}>{err}</Mono>}
        {sugg.length > 0 && (
          <View style={{ flexDirection: 'row', gap: 5, flexWrap: 'wrap', marginBottom: 6 }}>
            {sugg.map((s) => (
              <Pressable key={s.id} onPress={() => { tap(); setDraft(draft.slice(0, at) + '@' + s.name + ' '); }}
                style={{ borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3, borderWidth: StyleSheet.hairlineWidth, borderColor: t.you, backgroundColor: t.bg }}>
                <Text style={{ fontFamily: MONO, fontSize: 9, fontWeight: '700', color: t.you }}>@{s.name}</Text>
              </Pressable>
            ))}
          </View>
        )}
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          {canModerate && (
            <Pressable hitSlop={6} onPress={() => { tap(); setPollOpen((v) => !v); setGifOpen(false); }}>
              <Text style={{ fontSize: 15 }}>📊</Text>
            </Pressable>
          )}
          {!!GIF && (
            <Pressable hitSlop={6} onPress={() => { tap(); setGifOpen((v) => !v); setPollOpen(false); }}>
              <Text style={{ fontFamily: MONO, fontSize: 10, fontWeight: '700', color: t.dim }}>GIF</Text>
            </Pressable>
          )}
          <TextInput value={draft} maxLength={500} onChangeText={setDraft} onSubmitEditing={() => void sendBody(draft.trim())}
            placeholder="message the league… (@ to mention)" placeholderTextColor={t.faint} returnKeyType="send"
            style={{ flex: 1, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 8, paddingHorizontal: 11, paddingVertical: 8, fontSize: 13, color: t.text, backgroundColor: t.bg }} />
          <Pressable disabled={busy || !draft.trim()} onPress={() => { tap(); void sendBody(draft.trim()); }}
            style={{ backgroundColor: t.you, borderRadius: 8, paddingHorizontal: 14, justifyContent: 'center', opacity: busy || !draft.trim() ? 0.5 : 1, alignSelf: 'stretch' }}>
            <Text style={{ fontSize: 14, color: t.onAccent }}>➤</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function DmHome({ leagueId }: { leagueId: string }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
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
        <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd, paddingTop: 8, paddingBottom: 10 + insets.bottom }}>
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
  useEffect(() => { track(Ev.chatOpened, { dm: true }); }, []);
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
              <MsgBody body={m.body} names={[]} />
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
