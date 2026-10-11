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
  devRoomsMine, devRoomCreate, devRoomMessages, devRoomPost, devRoomTag, devRoomDelete,
  devRoomMembers, devRoomRemove, devRoomSetOpen, devRoomUsers, devRoomSetMember, friendlyError,
  type DevRoom, type DevMessage, type DevMember, type DevTag, type DevUser,
} from '@drip/core/data/liveApi';
import { issueUrl, TAG_LABEL } from '@drip/core/data/devRoom';

const POLL_MS = 5000;
const card: CSSProperties = { background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 10, padding: 14 };
const chip = (on: boolean): CSSProperties => ({
  fontFamily: 'inherit', fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', cursor: 'pointer',
  color: on ? 'var(--bg)' : 'var(--you)', background: on ? 'var(--you)' : 'transparent',
  border: '1px solid color-mix(in srgb, var(--you) 55%, var(--bd))', borderRadius: 999, padding: '5px 11px',
});
const small: CSSProperties = { fontSize: 10, color: 'var(--faint)' };
const fmtAt = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };

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

/** THE CHIP (v0.662.0). Founder: "Drip Dev chat needs to be a bit higher.
 *  Let's make it actually a floating chip pinned to the bottom left." It
 *  floats over the leagues page (v0.661.0's bar sat under the last card);
 *  tap it and the room opens in a panel above it, ⤢ opens the full room.
 *  Shown to a member of any room (an open room counts everyone) and to an
 *  admin. */
export function DevRoomBar({ onOpenFull }: { onOpenFull: (roomId: string | null) => void }) {
  const [rooms, setRooms] = useState<DevRoom[] | null>(null);
  const [canCreate, setCanCreate] = useState(false);
  const [open, setOpen] = useState(false);
  const read = useCallback(() => devRoomsMine().then((r) => { if (r.ok) { setRooms(r.rooms ?? []); setCanCreate(!!r.can_create); } }).catch(() => {}), []);
  useEffect(() => { void read(); const t = setInterval(() => { void read(); }, 30_000); return () => clearInterval(t); }, [read]);
  if (!rooms || (!rooms.length && !canCreate)) return null;
  const unread = rooms.reduce((n, r) => n + r.unread, 0);
  const name = rooms.length === 1 ? rooms[0].name : 'Dev room';
  return (
    <>
      {open && rooms.length > 0 && (
        <div style={{ position: 'fixed', left: 16, bottom: 72, zIndex: 70, width: 'min(440px, calc(100vw - 32px))', maxHeight: '72vh', overflowY: 'auto',
          ...card, display: 'grid', gap: 10, boxShadow: '0 12px 32px rgba(0,0,0,0.3)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="mono" style={{ fontSize: 11, fontWeight: 700, color: 'var(--you)', letterSpacing: '0.08em', flex: 1 }}>🛠 {name.toUpperCase()}</span>
            <button onClick={() => onOpenFull(rooms.length === 1 ? rooms[0].id : null)} className="mono" style={{ ...chip(false), padding: '3px 9px' }} title="Open the full room">⤢</button>
            <button onClick={() => { setOpen(false); void read(); }} className="mono" style={{ ...chip(false), padding: '3px 9px' }}>✕</button>
          </div>
          <DevRoomPanel rooms={rooms} />
        </div>
      )}
      <button onClick={() => { if (!rooms.length) { onOpenFull(null); return; } setOpen((o) => !o); if (open) void read(); }} className="mono"
        aria-label="Dev room"
        style={{ position: 'fixed', left: 16, bottom: 16, zIndex: 71, display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer',
          fontSize: 11.5, fontWeight: 700, letterSpacing: '0.06em', color: open ? 'var(--on-accent, var(--bg))' : 'var(--you)',
          background: open ? 'var(--you)' : 'var(--surface)', border: '1px solid color-mix(in srgb, var(--you) 55%, var(--bd))',
          borderRadius: 999, padding: '9px 14px', boxShadow: '0 6px 18px rgba(0,0,0,0.25)' }}>
        🛠 {rooms.length ? 'DEV' : 'DEV ROOM'}
        {unread > 0 && !open && <span style={{ fontSize: 10, color: 'var(--bg)', background: 'var(--you)', borderRadius: 999, padding: '1px 7px' }}>{unread}</span>}
      </button>
    </>
  );
}

/** The room in place — the bar's panel and league chat's 🛠 DEV chip. More
 *  than one room → a chip per room on top. */
export function DevRoomPanel({ rooms }: { rooms: DevRoom[] }) {
  const [roomId, setRoomId] = useState<string | null>(rooms[0]?.id ?? null);
  if (!roomId) return <div className="mono" style={small}>You’re not in a dev room.</div>;
  return (
    <>
      {rooms.length > 1 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {rooms.map((r) => <button key={r.id} onClick={() => setRoomId(r.id)} className="mono" style={chip(r.id === roomId)}>{r.name}{r.unread ? ` · ${r.unread}` : ''}</button>)}
        </div>
      )}
      <Room key={roomId} roomId={roomId} onLeft={() => setRoomId(null)} compact />
    </>
  );
}

/** Rooms I'm in (an open room joins me on this read) — for the chat chip. */
export function useDevRooms(): DevRoom[] {
  const [rooms, setRooms] = useState<DevRoom[]>([]);
  useEffect(() => { let alive = true; devRoomsMine().then((r) => { if (alive && r.ok) setRooms(r.rooms ?? []); }).catch(() => {}); return () => { alive = false; }; }, []);
  return rooms;
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
  const [name, setName] = useState('Drip Dev');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => devRoomsMine().then((r) => { if (r.ok) { setRooms(r.rooms ?? []); setCanCreate(!!r.can_create); } }).catch(() => {}), []);
  useEffect(() => { void load(); }, [load]);
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

function Room({ roomId, onLeft, compact }: { roomId: string; onLeft: () => void; compact?: boolean }) {
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
        <span style={{ fontSize: compact ? 14 : 18, fontWeight: 700, flex: 1 }}>{name}</span>
        <button onClick={() => setTab('chat')} className="mono" style={chip(tab === 'chat')}>CHAT</button>
        <button onClick={() => setTab('people')} className="mono" style={chip(tab === 'people')}>PEOPLE{admin ? ' & INVITES' : ''}</button>
      </div>
      {err && <div className="mono" style={{ fontSize: 11, color: 'var(--warn, #c66)' }}>{err}</div>}
      {tab === 'people' ? <People roomId={roomId} roomName={name} onLeft={onLeft} /> : (
        <>
          <div style={{ ...card, display: 'grid', gap: 12, maxHeight: compact ? '38vh' : '62vh', overflowY: 'auto' }}>
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
            <textarea value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={1000} rows={compact ? 2 : 3}
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
  const me = members.find((m) => m.me);
  // OPEN TO EVERYONE (0463). Read from the rooms list, which carries the flag.
  const [openAll, setOpenAll] = useState<boolean | null>(null);
  useEffect(() => { devRoomsMine().then((r) => { if (r.ok) setOpenAll(!!r.rooms?.find((x) => x.id === roomId)?.open); }).catch(() => {}); }, [roomId]);
  const setOpen = async (on: boolean) => {
    if (on && !window.confirm('Open this room to every signed-in player? Everyone gets the dev chip and can post (tagged lines become public GitHub issues).')) return;
    if (await act(devRoomSetOpen(roomId, on))) setOpenAll(on);
  };
  return (
    <>
      {err && <div className="mono" style={{ fontSize: 11, color: 'var(--warn, #c66)' }}>{err}</div>}
      {admin && openAll !== null && (
        <div style={{ ...card, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div className="mono" style={{ fontSize: 10, fontWeight: 700, color: 'var(--faint)', letterSpacing: '0.1em' }}>WHO’S IN</div>
            <div style={{ fontSize: 12.5, color: 'var(--dim)', marginTop: 4 }}>{openAll ? 'Everyone signed in — anyone you take out stays out.' : 'Only the people you switch on below.'}</div>
          </div>
          <button onClick={() => void setOpen(false)} className="mono" style={chip(!openAll)}>PICKED</button>
          <button onClick={() => void setOpen(true)} className="mono" style={chip(openAll)}>EVERYONE</button>
        </div>
      )}
      {admin ? <Roster roomId={roomId} onChanged={() => void load()} /> : (
        <div style={{ ...card, display: 'grid', gap: 8 }}>
          <div className="mono" style={{ fontSize: 10, fontWeight: 700, color: 'var(--faint)', letterSpacing: '0.1em' }}>MEMBERS ({members.length})</div>
          {members.map((m) => (
            <div key={m.user_id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ flex: 1, fontWeight: m.me ? 700 : 500 }}>{m.name}{m.me ? ' (you)' : ''}</span>
              {m.role === 'admin' && <span className="mono" style={{ ...small, color: 'var(--you)' }}>ADMIN</span>}
            </div>
          ))}
        </div>
      )}
      {me && !admin && (
        <button onClick={async () => { if (window.confirm('Leave the dev room? An admin can add you back.') && await act(devRoomRemove(roomId, me.user_id))) onLeft(); }}
          className="mono" style={{ ...chip(false), color: 'var(--faint)', justifySelf: 'start' }}>LEAVE THE ROOM</button>
      )}
    </>
  );
}

/** THE ROSTER (v0.662.0). Founder: "pull up the list of registered site users
 *  and toggle them in the dev chat. No other form of invite." Every account,
 *  the ones in the room first; a search narrows by name or email. */
function Roster({ roomId, onChanged }: { roomId: string; onChanged: () => void }) {
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
  useEffect(() => { const t = setTimeout(() => { void load(q).catch((e) => setErr(friendlyError(e))); }, 250); return () => clearTimeout(t); }, [load, q]);
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
    <div style={{ ...card, display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span className="mono" style={{ fontSize: 10, fontWeight: 700, color: 'var(--faint)', letterSpacing: '0.1em', flex: 1 }}>REGISTERED PLAYERS</span>
        <span className="mono" style={small}>{`${inCount} in · ${total} accounts`}</span>
      </div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a name or email…"
        style={{ fontSize: 13, padding: '7px 10px', background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--bd)', borderRadius: 6 }} />
      {err && <div className="mono" style={{ fontSize: 11, color: 'var(--warn, #c66)' }}>{err}</div>}
      {!users && <div className="mono" style={small}>Loading…</div>}
      {(users ?? []).map((u) => (
        <div key={u.user_id} style={{ display: 'flex', alignItems: 'center', gap: 10, borderTop: '1px solid var(--bd)', paddingTop: 7 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: u.in ? 700 : 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.name}{u.me ? ' (you)' : ''}{u.role === 'admin' ? ' · admin' : ''}</div>
            {u.email && <div className="mono" style={{ ...small, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.email}</div>}
          </div>
          <button onClick={() => void flip(u)} disabled={busy === u.user_id || (u.me && u.in)} className="mono" style={chip(u.in)}>{u.in ? 'IN' : 'OUT'}</button>
        </div>
      ))}
    </div>
  );
}
