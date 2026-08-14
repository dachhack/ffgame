// Chat (0147) — the league talks. Two surfaces behind one board button:
//
//   • LEAGUE — one channel per league, every member + the commissioner.
//   • DIRECT — one thread per member pair, scoped to this league (discovery
//     is the league's member list, names are its team names).
//
// Board-side like the commish kit: the people you'd message are the people
// you're playing, and the board is where you're looking when it matters.
// Reads POLL — 8s while a chat surface is open (the reveal cadence), 60s for
// the badge count — because the one realtime channel in this codebase is the
// matchup wire and chat doesn't need to be faster than the scoreboard.
// Opening a surface marks it read server-side (fetching the latest page IS
// the read); the badge poll never marks anything.
import { useEffect, useRef, useState } from 'react';
import {
  chatPost, chatMessages, chatDelete, chatUnread, chatMembers, dmSend, dmThreads, dmMessages,
  leagueNote, friendlyError,
  type ChatMessage, type DmThreadRow, type DmMessage,
} from '@drip/core/data/liveApi';
import { ModalBackdrop } from './ui';

const card: React.CSSProperties = { background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 8, padding: 0, width: '100%', maxWidth: 440, height: 'min(560px, 86vh)', display: 'flex', flexDirection: 'column', boxSizing: 'border-box', overflow: 'hidden' };
const input: React.CSSProperties = { fontFamily: 'inherit', fontSize: 13, color: 'var(--text)', background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 5, padding: '9px 11px', outline: 'none', width: '100%', boxSizing: 'border-box' };
const btn: React.CSSProperties = { fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--on-accent)', background: 'var(--you)', border: 'none', borderRadius: 5, padding: '9px 14px', cursor: 'pointer', whiteSpace: 'nowrap' };
const linkBtn: React.CSSProperties = { background: 'none', border: 'none', fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--dim)', cursor: 'pointer', padding: '2px 4px' };

const fmtWhen = (at: string): string => {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  const today = new Date();
  return d.toDateString() === today.toDateString()
    ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

/** The board's chat door: a toolbar button carrying the unread count, opening
 *  the panel. Self-contained by leagueId — polls its own badge. */
export function ChatButton({ leagueId, style }: { leagueId: string; style?: React.CSSProperties }) {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    let dead = false;
    const poll = () => chatUnread(leagueId)
      .then((r) => { if (!dead && r.ok) setUnread((r.league ?? 0) + (r.dm ?? 0)); })
      .catch(() => {});
    void poll();
    const id = setInterval(() => { if (!document.hidden && !open) void poll(); }, 60_000);
    return () => { dead = true; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId, open]);
  return (
    <>
      <button onClick={() => setOpen(true)} className="mono" style={style}
        title="league chat + direct messages">
        💬 CHAT{unread > 0 ? ` · ${unread > 99 ? '99+' : unread}` : ''}
      </button>
      {open && <ChatPanel leagueId={leagueId} onClose={() => { setOpen(false); setUnread(0); }} />}
    </>
  );
}

export function ChatPanel({ leagueId, onClose }: { leagueId: string; onClose: () => void }) {
  const [tab, setTab] = useState<'league' | 'dm'>('league');
  const [canModerate, setCanModerate] = useState(false);
  useEffect(() => { leagueNote(leagueId).then((r) => setCanModerate(!!r.can_edit)).catch(() => {}); }, [leagueId]);
  return (
    <ModalBackdrop onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '12px 14px 10px', borderBottom: '1px solid var(--bd)' }}>
          <div className="grotesk" style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>💬 Chat</div>
          <div style={{ flex: 1 }} />
          {(['league', 'dm'] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className="mono"
              style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', cursor: 'pointer', borderRadius: 999, padding: '4px 10px', color: tab === t ? 'var(--on-accent)' : 'var(--dim)', background: tab === t ? 'var(--you)' : 'var(--bg)', border: `1px solid ${tab === t ? 'var(--you)' : 'var(--bd)'}` }}>
              {t === 'league' ? 'LEAGUE' : 'DIRECT'}
            </button>
          ))}
          <button onClick={onClose} className="mono" style={{ ...linkBtn, fontSize: 14, marginLeft: 2 }}>✕</button>
        </div>
        {tab === 'league'
          ? <LeagueChat leagueId={leagueId} canModerate={canModerate} />
          : <DmHome leagueId={leagueId} />}
      </div>
    </ModalBackdrop>
  );
}

/** Shared scrolling message body: newest at the bottom, pinned there while
 *  new messages arrive unless the reader has scrolled up into history. */
function MessageScroll({ children, dep }: { children: React.ReactNode; dep: unknown }) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [dep]);
  return (
    <div ref={ref} onScroll={(e) => {
      const el = e.currentTarget;
      stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    }} style={{ flex: 1, overflowY: 'auto', padding: '10px 14px', minHeight: 0 }}>
      {children}
    </div>
  );
}

function LeagueChat({ leagueId, canModerate }: { leagueId: string; canModerate: boolean }) {
  const [msgs, setMsgs] = useState<ChatMessage[] | null>(null);
  const [draft, setDraft] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => chatMessages(leagueId)
    .then((r) => { if (r.ok && r.messages) setMsgs([...r.messages].reverse()); })
    .catch(() => {});
  useEffect(() => {
    void load();
    const id = setInterval(() => { if (!document.hidden) void load(); }, 8_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId]);
  const send = async () => {
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await chatPost(leagueId, body);
      if (!r.ok) { setErr(friendlyError(r.error ?? 'Could not send.')); return; }
      setDraft(''); await load();
    } catch (x) { setErr(friendlyError(x)); }
    finally { setBusy(false); }
  };
  const del = async (id: number) => {
    try { const r = await chatDelete(leagueId, id); if (r.ok) await load(); else setErr(friendlyError(r.error ?? '')); }
    catch (x) { setErr(friendlyError(x)); }
  };
  return (
    <>
      <MessageScroll dep={msgs?.length ?? 0}>
        {msgs == null && <div className="mono" style={{ fontSize: 10, color: 'var(--faint)' }}>Loading…</div>}
        {msgs?.length === 0 && <div className="mono" style={{ fontSize: 10, color: 'var(--faint)' }}>Nothing yet — say hello to the league.</div>}
        {msgs?.map((m) => (
          <div key={m.id} style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span className="mono" style={{ fontSize: 9, fontWeight: 700, color: m.mine ? 'var(--you)' : 'var(--warn)' }}>{m.author}</span>
              <span className="mono" style={{ fontSize: 8, color: 'var(--faint)' }}>{fmtWhen(m.at)}</span>
              {(m.mine || canModerate) && (
                <button onClick={() => void del(m.id)} className="mono" style={{ ...linkBtn, fontSize: 9, color: 'var(--opp)', padding: '0 2px' }}>✕</button>
              )}
            </div>
            <div style={{ fontSize: 12.5, lineHeight: 1.45, color: 'var(--text)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{m.body}</div>
          </div>
        ))}
      </MessageScroll>
      <Composer draft={draft} setDraft={setDraft} busy={busy} err={err} onSend={() => void send()} placeholder="message the league…" />
    </>
  );
}

function Composer({ draft, setDraft, busy, err, onSend, placeholder }: {
  draft: string; setDraft: (v: string) => void; busy: boolean; err: string | null; onSend: () => void; placeholder: string;
}) {
  return (
    <div style={{ borderTop: '1px solid var(--bd)', padding: '10px 14px' }}>
      {err && <div className="mono" style={{ fontSize: 9.5, color: 'var(--opp)', marginBottom: 6 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <input value={draft} maxLength={500} onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') onSend(); }}
          placeholder={placeholder} style={{ ...input, fontSize: 12.5 }} />
        <button onClick={onSend} disabled={busy || !draft.trim()} className="mono"
          style={{ ...btn, padding: '9px 16px', opacity: busy || !draft.trim() ? 0.5 : 1 }}>➤</button>
      </div>
    </div>
  );
}

function DmHome({ leagueId }: { leagueId: string }) {
  // null = thread list; {threadId: null, ...} = fresh compose to a member
  const [openThread, setOpenThread] = useState<{ threadId: string | null; peerId: string; peer: string } | null>(null);
  const [threads, setThreads] = useState<DmThreadRow[] | null>(null);
  const [pick, setPick] = useState(false);
  const [members, setMembers] = useState<{ id: string; name: string; me: boolean }[] | null>(null);
  const load = () => dmThreads(leagueId).then((r) => { if (r.ok && r.threads) setThreads(r.threads); }).catch(() => {});
  useEffect(() => {
    if (openThread) return;
    void load();
    const id = setInterval(() => { if (!document.hidden) void load(); }, 15_000);
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
    <>
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {pick ? (
          <div style={{ padding: '10px 14px' }}>
            <div className="mono" style={{ fontSize: 9, letterSpacing: '0.12em', color: 'var(--dim)', fontWeight: 700 }}>MESSAGE WHO?</div>
            {members == null && <div className="mono" style={{ fontSize: 10, color: 'var(--faint)', marginTop: 6 }}>Loading…</div>}
            {members?.filter((m) => !m.me).map((m) => (
              <button key={m.id} onClick={() => { setPick(false); setOpenThread({ threadId: null, peerId: m.id, peer: m.name }); }}
                style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', borderBottom: '1px solid var(--bd)', padding: '9px 2px', cursor: 'pointer', fontSize: 12.5, color: 'var(--text)' }}>
                {m.name}
              </button>
            ))}
            <button onClick={() => setPick(false)} className="mono" style={{ ...linkBtn, marginTop: 8 }}>← back</button>
          </div>
        ) : (
          <div style={{ padding: '10px 14px' }}>
            {threads == null && <div className="mono" style={{ fontSize: 10, color: 'var(--faint)' }}>Loading…</div>}
            {threads?.length === 0 && <div className="mono" style={{ fontSize: 10, color: 'var(--faint)' }}>No conversations yet.</div>}
            {threads?.map((t) => (
              <button key={t.thread_id} onClick={() => setOpenThread({ threadId: t.thread_id, peerId: t.peer_id, peer: t.peer })}
                style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', background: 'none', border: 'none', borderBottom: '1px solid var(--bd)', padding: '9px 2px', cursor: 'pointer' }}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 12.5, fontWeight: t.unread > 0 ? 700 : 400, color: 'var(--text)' }}>{t.peer}</span>
                  {t.preview && <span className="mono" style={{ display: 'block', fontSize: 9.5, color: 'var(--faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.preview}</span>}
                </span>
                <span className="mono" style={{ fontSize: 8, color: 'var(--faint)', flex: 'none' }}>{fmtWhen(t.last_at)}</span>
                {t.unread > 0 && (
                  <span className="mono" style={{ flex: 'none', fontSize: 8.5, fontWeight: 700, color: 'var(--on-accent)', background: 'var(--you)', borderRadius: 999, padding: '2px 7px' }}>{t.unread}</span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
      {!pick && (
        <div style={{ borderTop: '1px solid var(--bd)', padding: '10px 14px' }}>
          <button onClick={() => setPick(true)} className="mono" style={{ ...btn, width: '100%' }}>＋ NEW MESSAGE</button>
        </div>
      )}
    </>
  );
}

function DmThreadView({ leagueId, thread, onBack, onThreadId }: {
  leagueId: string;
  thread: { threadId: string | null; peerId: string; peer: string };
  onBack: () => void;
  onThreadId: (tid: string) => void;
}) {
  const [msgs, setMsgs] = useState<DmMessage[] | null>(thread.threadId ? null : []);
  const [draft, setDraft] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = (tid: string) => dmMessages(tid)
    .then((r) => { if (r.ok && r.messages) setMsgs([...r.messages].reverse()); })
    .catch(() => {});
  useEffect(() => {
    if (!thread.threadId) return;
    void load(thread.threadId);
    const id = setInterval(() => { if (!document.hidden && thread.threadId) void load(thread.threadId); }, 8_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread.threadId]);
  const send = async () => {
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await dmSend(leagueId, thread.peerId, body);
      if (!r.ok) { setErr(friendlyError(r.error ?? 'Could not send.')); return; }
      setDraft('');
      if (r.thread_id) { if (!thread.threadId) onThreadId(r.thread_id); await load(r.thread_id); }
    } catch (x) { setErr(friendlyError(x)); }
    finally { setBusy(false); }
  };
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderBottom: '1px solid var(--bd)' }}>
        <button onClick={onBack} className="mono" style={linkBtn}>←</button>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)' }}>{thread.peer}</span>
      </div>
      <MessageScroll dep={msgs?.length ?? 0}>
        {msgs == null && <div className="mono" style={{ fontSize: 10, color: 'var(--faint)' }}>Loading…</div>}
        {msgs?.length === 0 && <div className="mono" style={{ fontSize: 10, color: 'var(--faint)' }}>Say hello.</div>}
        {msgs?.map((m) => (
          <div key={m.id} style={{ display: 'flex', justifyContent: m.mine ? 'flex-end' : 'flex-start', marginBottom: 8 }}>
            <div style={{ maxWidth: '78%', borderRadius: 10, padding: '7px 11px', background: m.mine ? 'color-mix(in srgb, var(--you) 18%, var(--surface))' : 'var(--bg)', border: '1px solid var(--bd)' }}>
              <div style={{ fontSize: 12.5, lineHeight: 1.45, color: 'var(--text)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{m.body}</div>
              <div className="mono" style={{ fontSize: 7.5, color: 'var(--faint)', marginTop: 2, textAlign: m.mine ? 'right' : 'left' }}>{fmtWhen(m.at)}</div>
            </div>
          </div>
        ))}
      </MessageScroll>
      <Composer draft={draft} setDraft={setDraft} busy={busy} err={err} onSend={() => void send()} placeholder={`message ${thread.peer}…`} />
    </>
  );
}
