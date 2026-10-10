// THE DEV ROOM, web (v0.658.0, 0459). Founder: "Can I have a special dev
// group chat and invite users into the chat where they can log changes and
// suggestions for the game?"
//
// A chat that belongs to no league. People get in by an admin's invite link
// or code; a message tagged 💡 idea or 🐞 bug is filed as a GitHub issue by
// the worker (server/src/devRoom.js), and the issue number comes back on the
// message as a link. The repo is public, so the composer says so where the
// tag is chosen, and the issue carries no name (devRoomIssue.js).
//
// Polled like league chat (0147): every few seconds while open.
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  devRoomsMine, devRoomCreate, devRoomJoin, devRoomMessages, devRoomPost, devRoomTag, devRoomDelete,
  devRoomMembers, devRoomRemove, devRoomInviteCreate, devRoomInvites, devRoomInviteRevoke, friendlyError,
  type DevRoom, type DevMessage, type DevMember, type DevInvite, type DevTag,
} from '@drip/core/data/liveApi';
import { devRoomLink, devRoomInviteMessage, cleanDevCode, issueUrl, TAG_LABEL } from '@drip/core/data/devRoom';

const POLL_MS = 5000;
const card: CSSProperties = { background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 10, padding: 14 };
const chip = (on: boolean): CSSProperties => ({
  fontFamily: 'inherit', fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', cursor: 'pointer',
  color: on ? 'var(--bg)' : 'var(--you)', background: on ? 'var(--you)' : 'transparent',
  border: '1px solid color-mix(in srgb, var(--you) 55%, var(--bd))', borderRadius: 999, padding: '5px 11px',
});
const small: CSSProperties = { fontSize: 10, color: 'var(--faint)' };
const fmtAt = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
const copy = (s: string) => { try { void navigator.clipboard.writeText(s); } catch { /* ignore */ } };

/** The home-screen door: shown to a member of any room, and to an admin. */
export function DevRoomBanner({ onOpen }: { onOpen: (roomId: string | null) => void }) {
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
    <button onClick={() => onOpen(rooms.length === 1 ? rooms[0].id : null)} className="mono"
      style={{ ...card, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, width: '100%', cursor: 'pointer', textAlign: 'left', marginBottom: 12 }}>
      <span>
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--you)', letterSpacing: '0.08em' }}>🛠 DEV ROOM</span>
        <span style={{ ...small, marginLeft: 8 }}>{rooms.length ? rooms.map((r) => r.name).join(' · ') : 'make one and invite testers'}</span>
      </span>
      {unread > 0 && <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--bg)', background: 'var(--you)', borderRadius: 999, padding: '2px 8px' }}>{unread}</span>}
    </button>
  );
}

/** The room itself. `roomId` null opens the list (pick, join, or make one). */
export function DevRoomScreen({ roomId: initial, onBack }: { roomId: string | null; onBack: () => void }) {
  const [roomId, setRoomId] = useState<string | null>(initial);
  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '14px 14px 60px', display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={roomId && !initial ? () => setRoomId(null) : onBack} className="mono" style={chip(false)}>← {roomId && !initial ? 'ROOMS' : 'BACK'}</button>
        <span className="mono" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--you)' }}>🛠 DEV ROOM</span>
      </div>
      {roomId ? <Room roomId={roomId} onLeft={() => setRoomId(null)} /> : <RoomList onPick={setRoomId} />}
    </div>
  );
}

function RoomList({ onPick }: { onPick: (id: string) => void }) {
  const [rooms, setRooms] = useState<DevRoom[]>([]);
  const [canCreate, setCanCreate] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('Drip Dev');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => devRoomsMine().then((r) => { if (r.ok) { setRooms(r.rooms ?? []); setCanCreate(!!r.can_create); } }).catch(() => {}), []);
  useEffect(() => { void load(); }, [load]);
  const join = async () => {
    setBusy(true); setErr(null);
    try { const r = await devRoomJoin(cleanDevCode(code)); if (r.ok && r.room_id) onPick(r.room_id); else setErr(r.error ?? 'Couldn’t join.'); }
    catch (e) { setErr(friendlyError(e)); } finally { setBusy(false); }
  };
  const create = async () => {
    setBusy(true); setErr(null);
    try { const r = await devRoomCreate(name); if (r.ok && r.room_id) onPick(r.room_id); else setErr(r.error ?? 'Couldn’t make it.'); }
    catch (e) { setErr(friendlyError(e)); } finally { setBusy(false); }
  };
  return (
    <>
      {rooms.map((r) => (
        <button key={r.id} onClick={() => onPick(r.id)} style={{ ...card, display: 'flex', justifyContent: 'space-between', cursor: 'pointer', textAlign: 'left' }}>
          <span><span style={{ fontWeight: 700 }}>{r.name}</span> <span className="mono" style={small}>{r.members} member{r.members === 1 ? '' : 's'}{r.role === 'admin' ? ' · admin' : ''}</span></span>
          {r.unread > 0 && <span className="mono" style={{ fontSize: 10, fontWeight: 700, color: 'var(--you)' }}>{r.unread} new</span>}
        </button>
      ))}
      <div style={card}>
        <div className="mono" style={{ fontSize: 10, fontWeight: 700, color: 'var(--faint)', letterSpacing: '0.1em' }}>HAVE AN INVITE CODE?</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="ABCD1234" className="mono"
            style={{ flex: 1, fontSize: 13, padding: '7px 10px', background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--bd)', borderRadius: 6 }} />
          <button onClick={() => void join()} disabled={busy || cleanDevCode(code).length < 8} className="mono" style={chip(true)}>JOIN</button>
        </div>
      </div>
      {canCreate && (
        <div style={card}>
          <div className="mono" style={{ fontSize: 10, fontWeight: 700, color: 'var(--faint)', letterSpacing: '0.1em' }}>MAKE A ROOM (ADMIN)</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60}
              style={{ flex: 1, fontSize: 13, padding: '7px 10px', background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--bd)', borderRadius: 6 }} />
            <button onClick={() => void create()} disabled={busy} className="mono" style={chip(true)}>MAKE IT</button>
          </div>
        </div>
      )}
      {err && <div className="mono" style={{ fontSize: 11, color: 'var(--warn, #c66)' }}>{err}</div>}
    </>
  );
}

function Room({ roomId, onLeft }: { roomId: string; onLeft: () => void }) {
  const [tab, setTab] = useState<'chat' | 'people'>('chat');
  const [name, setName] = useState('');
  const [msgs, setMsgs] = useState<DevMessage[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [tag, setTag] = useState<DevTag | null>(null);
  const [busy, setBusy] = useState(false);
  const [admin, setAdmin] = useState(false);
  const end = useRef<HTMLDivElement | null>(null);
  const count = useRef(0);

  const load = useCallback(async () => {
    const r = await devRoomMessages(roomId);
    if (!r.ok) { setErr(r.error ?? 'Couldn’t read the room.'); return; }
    setErr(null); setName(r.name ?? ''); setMsgs([...(r.messages ?? [])].reverse());
  }, [roomId]);
  useEffect(() => {
    void load().catch((e) => setErr(friendlyError(e)));
    devRoomMembers(roomId).then((r) => { if (r.ok) setAdmin(!!r.admin); }).catch(() => {});
    const t = setInterval(() => { void load().catch(() => {}); }, POLL_MS);
    return () => clearInterval(t);
  }, [load, roomId]);
  useEffect(() => {
    if (msgs.length > count.current) end.current?.scrollIntoView({ block: 'end' });
    count.current = msgs.length;
  }, [msgs.length]);

  const send = async () => {
    if (!draft.trim() || busy) return;
    setBusy(true);
    try {
      const r = await devRoomPost(roomId, draft, tag);
      if (!r.ok) { setErr(r.error ?? 'Didn’t send.'); return; }
      setDraft(''); setTag(null); await load();
    } catch (e) { setErr(friendlyError(e)); } finally { setBusy(false); }
  };
  const retag = async (m: DevMessage, t: DevTag | null) => {
    const r = await devRoomTag(m.id, t).catch((e) => ({ ok: false, error: friendlyError(e) }));
    if (!r.ok) setErr(r.error ?? 'Couldn’t tag it.'); else await load();
  };
  const del = async (m: DevMessage) => {
    if (!window.confirm('Delete this message?')) return;
    const r = await devRoomDelete(m.id).catch((e) => ({ ok: false, error: friendlyError(e) }));
    if (!r.ok) setErr(r.error ?? 'Couldn’t delete it.'); else await load();
  };

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 18, fontWeight: 700, flex: 1 }}>{name}</span>
        <button onClick={() => setTab('chat')} className="mono" style={chip(tab === 'chat')}>CHAT</button>
        <button onClick={() => setTab('people')} className="mono" style={chip(tab === 'people')}>PEOPLE{admin ? ' & INVITES' : ''}</button>
      </div>
      {err && <div className="mono" style={{ fontSize: 11, color: 'var(--warn, #c66)' }}>{err}</div>}
      {tab === 'people' ? <People roomId={roomId} roomName={name} onLeft={onLeft} /> : (
        <>
          <div style={{ ...card, display: 'grid', gap: 12, maxHeight: '62vh', overflowY: 'auto' }}>
            {!msgs.length && <div className="mono" style={small}>Nothing yet. Say what you’d change — tag it 💡 or 🐞 to log it.</div>}
            {msgs.map((m) => {
              const open = !m.issue && !m.filing;
              const canTag = open && (m.mine || admin);
              return (
                <div key={m.id} style={{ display: 'grid', gap: 3 }}>
                  <div className="mono" style={{ ...small, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, color: m.mine ? 'var(--you)' : 'var(--dim)' }}>{m.mine ? 'you' : m.author}</span>
                    <span>{fmtAt(m.at)}</span>
                    {m.tag && <span style={{ fontWeight: 700, color: m.tag === 'bug' ? 'var(--warn, #c66)' : 'var(--you)' }}>{TAG_LABEL[m.tag]}</span>}
                    {m.issue ? <a href={issueUrl(m.issue)} target="_blank" rel="noreferrer" style={{ color: 'var(--you)' }}>logged #{m.issue} ↗</a>
                      : m.tag ? <span>{m.filing ? 'logging…' : 'queued to log'}</span> : null}
                  </div>
                  <div style={{ fontSize: 13.5, lineHeight: 1.45, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{m.body}</div>
                  {(canTag || m.mine || admin) && (
                    <div className="mono" style={{ display: 'flex', gap: 10, fontSize: 9.5 }}>
                      {canTag && (['idea', 'bug'] as const).map((t) => (
                        <button key={t} onClick={() => void retag(m, m.tag === t ? null : t)}
                          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: m.tag === t ? 'var(--you)' : 'var(--faint)', fontFamily: 'inherit', fontSize: 'inherit' }}>
                          {m.tag === t ? `✓ ${TAG_LABEL[t]}` : `tag ${TAG_LABEL[t]}`}
                        </button>
                      ))}
                      {(m.mine || admin) && (
                        <button onClick={() => void del(m)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--faint)', fontFamily: 'inherit', fontSize: 'inherit' }}>delete</button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            <div ref={end} />
          </div>
          <div style={{ ...card, display: 'grid', gap: 8 }}>
            <textarea value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={1000} rows={3}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void send(); }}
              placeholder="A suggestion, a bug, a thought…"
              style={{ fontSize: 13.5, padding: 10, background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--bd)', borderRadius: 6, resize: 'vertical', fontFamily: 'inherit' }} />
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button onClick={() => setTag(null)} className="mono" style={chip(tag === null)}>JUST CHAT</button>
              <button onClick={() => setTag('idea')} className="mono" style={chip(tag === 'idea')}>{TAG_LABEL.idea}</button>
              <button onClick={() => setTag('bug')} className="mono" style={chip(tag === 'bug')}>{TAG_LABEL.bug}</button>
              <span style={{ flex: 1 }} />
              <button onClick={() => void send()} disabled={busy || !draft.trim()} className="mono" style={chip(true)}>SEND</button>
            </div>
            {/* THE PUBLIC LINE. A tagged message leaves the app: said where
                the choice is made, not buried in a FAQ. */}
            <div className="mono" style={small}>
              {tag ? 'Tagged messages are logged as public GitHub issues (your name isn’t included).' : 'Tag a message 💡 or 🐞 to log it as a public GitHub issue (no names).'}
            </div>
          </div>
        </>
      )}
    </>
  );
}

function People({ roomId, roomName, onLeft }: { roomId: string; roomName: string; onLeft: () => void }) {
  const [members, setMembers] = useState<DevMember[]>([]);
  const [admin, setAdmin] = useState(false);
  const [invites, setInvites] = useState<DevInvite[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
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
  const flash = (k: string, s: string) => { copy(s); setCopied(k); setTimeout(() => setCopied(null), 1500); };
  const me = members.find((m) => m.me);
  return (
    <>
      {err && <div className="mono" style={{ fontSize: 11, color: 'var(--warn, #c66)' }}>{err}</div>}
      {admin && (
        <div style={{ ...card, display: 'grid', gap: 8 }}>
          <div className="mono" style={{ fontSize: 10, fontWeight: 700, color: 'var(--faint)', letterSpacing: '0.1em' }}>INVITE PEOPLE</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={() => void act(devRoomInviteCreate(roomId, 1))} className="mono" style={chip(true)}>＋ ONE-PERSON CODE</button>
            <button onClick={() => void act(devRoomInviteCreate(roomId, null))} className="mono" style={chip(false)}>＋ REUSABLE CODE</button>
          </div>
          {invites.map((i) => (
            <div key={i.code} className="mono" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: 11, borderTop: '1px solid var(--bd)', paddingTop: 8 }}>
              <span style={{ fontWeight: 700, letterSpacing: '0.1em' }}>{i.code}</span>
              <span style={small}>{i.max_uses == null ? `used ${i.uses}× · reusable` : `${i.uses}/${i.max_uses} used`}</span>
              <span style={{ flex: 1 }} />
              <button onClick={() => flash(`l${i.code}`, devRoomLink(i.code))} style={chip(false)}>{copied === `l${i.code}` ? '✓ COPIED' : 'COPY LINK'}</button>
              <button onClick={() => flash(`m${i.code}`, devRoomInviteMessage({ room: roomName, code: i.code }))} style={chip(false)}>{copied === `m${i.code}` ? '✓ COPIED' : 'COPY MESSAGE'}</button>
              <button onClick={() => void act(devRoomInviteRevoke(i.code))} style={{ ...chip(false), color: 'var(--faint)' }}>REVOKE</button>
            </div>
          ))}
        </div>
      )}
      <div style={{ ...card, display: 'grid', gap: 8 }}>
        <div className="mono" style={{ fontSize: 10, fontWeight: 700, color: 'var(--faint)', letterSpacing: '0.1em' }}>MEMBERS ({members.length})</div>
        {members.map((m) => (
          <div key={m.user_id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ flex: 1, fontWeight: m.me ? 700 : 500 }}>{m.name}{m.me ? ' (you)' : ''}</span>
            {m.role === 'admin' && <span className="mono" style={{ ...small, color: 'var(--you)' }}>ADMIN</span>}
            {admin && !m.me && (
              <button onClick={() => { if (window.confirm(`Remove ${m.name} from the room?`)) void act(devRoomRemove(roomId, m.user_id)); }}
                className="mono" style={{ ...chip(false), color: 'var(--faint)' }}>REMOVE</button>
            )}
          </div>
        ))}
      </div>
      {me && (
        <button onClick={async () => { if (window.confirm('Leave the dev room? You’ll need a new invite to come back.') && await act(devRoomRemove(roomId, me.user_id))) onLeft(); }}
          className="mono" style={{ ...chip(false), color: 'var(--faint)', justifySelf: 'start' }}>LEAVE THE ROOM</button>
      )}
    </>
  );
}
