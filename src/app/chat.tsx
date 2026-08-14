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
  chatPostPoll, pollCast, chatPin,
  leagueNote, friendlyError,
  type ChatMessage, type DmThreadRow, type DmMessage,
} from '@drip/core/data/liveApi';
import { ModalBackdrop } from './ui';

// ── chat v2 (0148): inline media, @mentions, polls, pins ────────────────────

/** Only these hosts (or bare image files) render inline — anything else stays text. */
const isImageUrl = (s: string): boolean => {
  const t = s.trim();
  if (!/^https?:\/\/\S+$/.test(t)) return false;
  return /^(https?:\/\/)(media\d*\.tenor\.com|media\d*\.giphy\.com|i\.giphy\.com|i\.imgur\.com)\//i.test(t)
    || /\.(gif|png|jpe?g|webp)(\?\S*)?$/i.test(t);
};
const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A message body: whole-URL images render inline; @TeamName tokens highlight
 *  against the league's real member names (longest name wins). */
function Body({ body, names }: { body: string; names: string[] }) {
  if (isImageUrl(body)) {
    return <img src={body.trim()} alt="" loading="lazy"
      style={{ display: 'block', maxWidth: '100%', maxHeight: 200, borderRadius: 8, marginTop: 2 }} />;
  }
  if (!names.length || !body.includes('@')) return <>{body}</>;
  const re = new RegExp(`@(${[...names].sort((a, b) => b.length - a.length).map(escRe).join('|')})`, 'g');
  const parts: React.ReactNode[] = [];
  let last = 0; let mm: RegExpExecArray | null; let k = 0;
  while ((mm = re.exec(body))) {
    if (mm.index > last) parts.push(body.slice(last, mm.index));
    parts.push(<b key={k++} style={{ color: 'var(--you)', fontWeight: 700 }}>{mm[0]}</b>);
    last = mm.index + mm[0].length;
  }
  if (last < body.length) parts.push(body.slice(last));
  return <>{parts}</>;
}

/** Free Tenor v2 key — set VITE_TENOR_KEY and the GIF picker lights up;
 *  without it the button hides (pasted GIF links still render inline). */
const TENOR_KEY = (import.meta.env.VITE_TENOR_KEY as string | undefined) || undefined;
interface TenorGif { id: string; tiny: string; full: string; }
function GifPicker({ onPick, onClose }: { onPick: (url: string) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [gifs, setGifs] = useState<TenorGif[] | null>(null);
  useEffect(() => {
    if (!TENOR_KEY) return;
    const t = setTimeout(() => {
      const base = q.trim()
        ? `https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(q.trim())}`
        : 'https://tenor.googleapis.com/v2/featured?';
      fetch(`${base}&key=${TENOR_KEY}&limit=12&media_filter=gif,tinygif`)
        .then((r) => r.json())
        .then((d: { results?: { id: string; media_formats?: Record<string, { url?: string }> }[] }) => {
          setGifs((d.results ?? []).map((g) => ({
            id: g.id,
            tiny: g.media_formats?.tinygif?.url ?? g.media_formats?.gif?.url ?? '',
            full: g.media_formats?.gif?.url ?? g.media_formats?.tinygif?.url ?? '',
          })).filter((g) => g.tiny && g.full));
        })
        .catch(() => setGifs([]));
    }, 300);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div style={{ borderTop: '1px solid var(--bd)', padding: '8px 14px', maxHeight: 240, overflowY: 'auto' }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input value={q} autoFocus onChange={(e) => setQ(e.target.value)} placeholder="search GIFs…"
          style={{ ...input, fontSize: 11.5, padding: '6px 9px' }} />
        <button onClick={onClose} className="mono" style={linkBtn}>✕</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginTop: 8 }}>
        {gifs == null && <span className="mono" style={{ fontSize: 9, color: 'var(--faint)' }}>Loading…</span>}
        {gifs?.length === 0 && <span className="mono" style={{ fontSize: 9, color: 'var(--faint)' }}>Nothing found.</span>}
        {gifs?.map((g) => (
          <img key={g.id} src={g.tiny} alt="" loading="lazy" onClick={() => onPick(g.full)}
            style={{ width: '100%', height: 74, objectFit: 'cover', borderRadius: 6, cursor: 'pointer' }} />
        ))}
      </div>
      <div className="mono" style={{ fontSize: 7.5, color: 'var(--faint)', marginTop: 6 }}>via Tenor</div>
    </div>
  );
}

/** A poll message's options — tap to vote, tap another to change. */
function PollView({ m, leagueId, onVoted }: { m: ChatMessage; leagueId: string; onVoted: () => void }) {
  const p = m.poll;
  if (!p) return null;
  const total = p.total || 0;
  return (
    <div style={{ marginTop: 4, maxWidth: 340 }}>
      {p.options.map((o, i) => {
        const on = p.mine === i;
        const pct = total ? Math.round((o.votes / total) * 100) : 0;
        return (
          <button key={i} onClick={() => void pollCast(leagueId, m.id, i).then(onVoted).catch(() => {})}
            style={{ position: 'relative', display: 'block', width: '100%', textAlign: 'left', marginTop: 4, padding: '6px 9px', borderRadius: 6, cursor: 'pointer', background: 'var(--bg)', border: `1px solid ${on ? 'var(--you)' : 'var(--bd)'}`, overflow: 'hidden' }}>
            <span style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: `${pct}%`, background: 'color-mix(in srgb, var(--you) 14%, transparent)' }} />
            <span style={{ position: 'relative', fontSize: 12, color: 'var(--text)', fontWeight: on ? 700 : 400 }}>{on ? '● ' : ''}{o.text}</span>
            <span className="mono" style={{ position: 'relative', float: 'right', fontSize: 9, color: 'var(--dim)' }}>{o.votes}</span>
          </button>
        );
      })}
      <div className="mono" style={{ fontSize: 8.5, color: 'var(--faint)', marginTop: 3 }}>📊 {total} vote{total === 1 ? '' : 's'} · tap to vote or change</div>
    </div>
  );
}

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
  const [mentioned, setMentioned] = useState(false);
  useEffect(() => {
    let dead = false;
    const poll = () => chatUnread(leagueId)
      .then((r) => {
        if (!dead && r.ok) { setUnread((r.league ?? 0) + (r.dm ?? 0)); setMentioned((r.mention ?? 0) > 0); }
      })
      .catch(() => {});
    void poll();
    const id = setInterval(() => { if (!document.hidden && !open) void poll(); }, 60_000);
    return () => { dead = true; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId, open]);
  return (
    <>
      <button onClick={() => setOpen(true)} className="mono" style={style}
        title={mentioned ? 'someone mentioned you' : 'league chat + direct messages'}>
        💬 CHAT{mentioned ? ' @' : ''}{unread > 0 ? ` · ${unread > 99 ? '99+' : unread}` : ''}
      </button>
      {open && <ChatPanel leagueId={leagueId} onClose={() => { setOpen(false); setUnread(0); setMentioned(false); }} />}
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
  const [pins, setPins] = useState<ChatMessage[]>([]);
  const [pinsOpen, setPinsOpen] = useState(false);
  const [members, setMembers] = useState<{ id: string; name: string; me: boolean }[]>([]);
  const [draft, setDraft] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pollOpen, setPollOpen] = useState(false);
  const [gifOpen, setGifOpen] = useState(false);
  const load = () => chatMessages(leagueId)
    .then((r) => {
      if (r.ok && r.messages) { setMsgs([...r.messages].reverse()); setPins(r.pins ?? []); }
    })
    .catch(() => {});
  useEffect(() => {
    void load();
    chatMembers(leagueId).then((r) => { if (r.ok && r.members) setMembers(r.members); }).catch(() => {});
    const id = setInterval(() => { if (!document.hidden) void load(); }, 8_000);
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
      if (!r.ok) { setErr(friendlyError(r.error ?? 'Could not send.')); return; }
      setDraft(''); setGifOpen(false); await load();
    } catch (x) { setErr(friendlyError(x)); }
    finally { setBusy(false); }
  };
  const del = async (id: number) => {
    try { const r = await chatDelete(leagueId, id); if (r.ok) await load(); else setErr(friendlyError(r.error ?? '')); }
    catch (x) { setErr(friendlyError(x)); }
  };
  const pin = async (id: number, on: boolean) => {
    try { const r = await chatPin(leagueId, id, on); if (r.ok) await load(); else setErr(friendlyError(r.error ?? '')); }
    catch (x) { setErr(friendlyError(x)); }
  };

  // @-autocomplete over the tail of the draft: an @ opening a word, with
  // whatever follows as the query (team names may contain spaces).
  const at = draft.lastIndexOf('@');
  const mq = at >= 0 && (at === 0 || /\s/.test(draft[at - 1])) ? draft.slice(at + 1) : null;
  const sugg = mq != null && mq.length <= 24 && !mq.includes('@')
    ? members.filter((m) => !m.me && m.name.toLowerCase().startsWith(mq.toLowerCase()) && m.name.toLowerCase() !== mq.toLowerCase().trim()).slice(0, 5)
    : [];

  return (
    <>
      {pins.length > 0 && (
        <div style={{ borderBottom: '1px solid var(--bd)', background: 'color-mix(in srgb, var(--warn) 6%, var(--surface))', padding: '6px 14px' }}>
          <button onClick={() => setPinsOpen((v) => !v)} className="mono"
            style={{ ...linkBtn, padding: 0, fontSize: 9, color: 'var(--warn)' }}>
            📌 {pins.length} PINNED {pinsOpen ? '▾' : '▸'}
          </button>
          {pinsOpen && pins.map((p) => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 5 }}>
              <span className="mono" style={{ fontSize: 8.5, fontWeight: 700, color: 'var(--dim)', flex: 'none' }}>{p.author}</span>
              <span style={{ flex: 1, minWidth: 0, fontSize: 11.5, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {p.kind === 'poll' ? `📊 ${p.body}` : isImageUrl(p.body) ? '🖼 GIF' : p.body}
              </span>
              {canModerate && (
                <button onClick={() => void pin(p.id, false)} className="mono" style={{ ...linkBtn, fontSize: 8.5, padding: 0 }} title="unpin">✕</button>
              )}
            </div>
          ))}
        </div>
      )}
      <MessageScroll dep={msgs?.length ?? 0}>
        {msgs == null && <div className="mono" style={{ fontSize: 10, color: 'var(--faint)' }}>Loading…</div>}
        {msgs?.length === 0 && <div className="mono" style={{ fontSize: 10, color: 'var(--faint)' }}>Nothing yet — say hello to the league.</div>}
        {msgs?.map((m) => (
          <div key={m.id} style={{ marginBottom: 10, ...(m.mentions_me ? { background: 'color-mix(in srgb, var(--you) 8%, transparent)', borderRadius: 6, padding: '4px 6px', margin: '0 -6px 10px' } : {}) }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span className="mono" style={{ fontSize: 9, fontWeight: 700, color: m.mine ? 'var(--you)' : 'var(--warn)' }}>{m.author}</span>
              <span className="mono" style={{ fontSize: 8, color: 'var(--faint)' }}>{fmtWhen(m.at)}</span>
              {m.pinned && <span className="mono" style={{ fontSize: 8, color: 'var(--warn)' }}>📌</span>}
              {canModerate && (
                <button onClick={() => void pin(m.id, !m.pinned)} className="mono" title={m.pinned ? 'unpin' : 'pin'}
                  style={{ ...linkBtn, fontSize: 9, padding: '0 2px' }}>{m.pinned ? '📌✕' : '📌'}</button>
              )}
              {(m.mine || canModerate) && (
                <button onClick={() => void del(m.id)} className="mono" style={{ ...linkBtn, fontSize: 9, color: 'var(--opp)', padding: '0 2px' }}>✕</button>
              )}
            </div>
            {m.kind === 'poll'
              ? <>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)' }}>📊 {m.body}</div>
                  <PollView m={m} leagueId={leagueId} onVoted={() => void load()} />
                </>
              : <div style={{ fontSize: 12.5, lineHeight: 1.45, color: 'var(--text)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                  <Body body={m.body} names={names} />
                </div>}
          </div>
        ))}
      </MessageScroll>
      {pollOpen && <PollComposer leagueId={leagueId} onDone={() => { setPollOpen(false); void load(); }} onClose={() => setPollOpen(false)} />}
      {gifOpen && TENOR_KEY && <GifPicker onPick={(url) => void sendBody(url)} onClose={() => setGifOpen(false)} />}
      <div style={{ borderTop: '1px solid var(--bd)', padding: '10px 14px' }}>
        {err && <div className="mono" style={{ fontSize: 9.5, color: 'var(--opp)', marginBottom: 6 }}>{err}</div>}
        {sugg.length > 0 && (
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 6 }}>
            {sugg.map((s) => (
              <button key={s.id} onClick={() => setDraft(draft.slice(0, at) + '@' + s.name + ' ')} className="mono"
                style={{ fontSize: 9, fontWeight: 700, cursor: 'pointer', borderRadius: 999, padding: '3px 9px', color: 'var(--you)', background: 'var(--bg)', border: '1px solid var(--you)' }}>
                @{s.name}
              </button>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: 6 }}>
          {canModerate && (
            <button onClick={() => { setPollOpen((v) => !v); setGifOpen(false); }} title="post a poll" className="mono"
              style={{ ...linkBtn, fontSize: 13, padding: '0 2px' }}>📊</button>
          )}
          {TENOR_KEY && (
            <button onClick={() => { setGifOpen((v) => !v); setPollOpen(false); }} title="send a GIF" className="mono"
              style={{ ...linkBtn, fontSize: 11, padding: '0 2px', alignSelf: 'center' }}>GIF</button>
          )}
          <input value={draft} maxLength={500} onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !sugg.length) void sendBody(draft.trim()); }}
            placeholder="message the league… (@ to mention)" style={{ ...input, fontSize: 12.5 }} />
          <button onClick={() => void sendBody(draft.trim())} disabled={busy || !draft.trim()} className="mono"
            style={{ ...btn, padding: '9px 16px', opacity: busy || !draft.trim() ? 0.5 : 1 }}>➤</button>
        </div>
      </div>
    </>
  );
}

/** The commissioner's poll form: a question and 2–6 options. */
function PollComposer({ leagueId, onDone, onClose }: { leagueId: string; onDone: () => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [opts, setOpts] = useState<string[]>(['', '']);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const post = async () => {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await chatPostPoll(leagueId, q.trim(), opts.map((o) => o.trim()).filter(Boolean));
      if (!r.ok) { setErr(friendlyError(r.error ?? 'Could not post the poll.')); return; }
      onDone();
    } catch (x) { setErr(friendlyError(x)); }
    finally { setBusy(false); }
  };
  return (
    <div style={{ borderTop: '1px solid var(--bd)', padding: '10px 14px' }}>
      <div className="mono" style={{ fontSize: 9, letterSpacing: '0.12em', color: 'var(--dim)', fontWeight: 700 }}>📊 NEW POLL</div>
      <input value={q} autoFocus maxLength={500} onChange={(e) => setQ(e.target.value)} placeholder="the question…"
        style={{ ...input, fontSize: 12, marginTop: 6 }} />
      {opts.map((o, i) => (
        <input key={i} value={o} maxLength={60} onChange={(e) => setOpts(opts.map((x, j) => (j === i ? e.target.value : x)))}
          placeholder={`option ${i + 1}`} style={{ ...input, fontSize: 11.5, marginTop: 5, padding: '6px 9px' }} />
      ))}
      {err && <div className="mono" style={{ fontSize: 9.5, color: 'var(--opp)', marginTop: 6 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
        {opts.length < 6 && (
          <button onClick={() => setOpts([...opts, ''])} className="mono" style={linkBtn}>＋ option</button>
        )}
        <div style={{ flex: 1 }} />
        <button onClick={onClose} className="mono" style={linkBtn}>cancel</button>
        <button onClick={() => void post()} disabled={busy || !q.trim() || opts.filter((o) => o.trim()).length < 2}
          className="mono" style={{ ...btn, padding: '7px 14px', opacity: busy || !q.trim() || opts.filter((o) => o.trim()).length < 2 ? 0.5 : 1 }}>
          POST POLL
        </button>
      </div>
    </div>
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
              <div style={{ fontSize: 12.5, lineHeight: 1.45, color: 'var(--text)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}><Body body={m.body} names={[]} /></div>
              <div className="mono" style={{ fontSize: 7.5, color: 'var(--faint)', marginTop: 2, textAlign: m.mine ? 'right' : 'left' }}>{fmtWhen(m.at)}</div>
            </div>
          </div>
        ))}
      </MessageScroll>
      <Composer draft={draft} setDraft={setDraft} busy={busy} err={err} onSend={() => void send()} placeholder={`message ${thread.peer}…`} />
    </>
  );
}
