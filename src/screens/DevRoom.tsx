// THE DEV ROOM, web (v0.658.0, 0459; v0.663.0). Founder: "Can I have a special
// dev group chat and invite users into the chat where they can log changes and
// suggestions for the game?"
//
// A chat that belongs to no league. An admin switches people in from the list
// of every registered player (0464). Since v0.663.0 the thread IS league
// chat's (app/chat.tsx DevChat): pictures, GIFs, polls, reactions, @mentions,
// and @computer from any member, filed by the worker (server/src/computer.js)
// with Computer's reply and fix card back in the room.
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import {
  devRoomsMine, devRoomCreate,
  devRoomMembers, devRoomRemove, devRoomSetOpen, devRoomUsers, devRoomSetMember, friendlyError,
  type DevRoom, type DevMember, type DevUser,
} from '@drip/core/data/liveApi';
import { DevChat } from '../app/chat';

const card: CSSProperties = { background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 10, padding: 14 };
const chip = (on: boolean): CSSProperties => ({
  fontFamily: 'inherit', fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', cursor: 'pointer',
  color: on ? 'var(--bg)' : 'var(--you)', background: on ? 'var(--you)' : 'transparent',
  border: '1px solid color-mix(in srgb, var(--you) 55%, var(--bd))', borderRadius: 999, padding: '5px 11px',
});
const small: CSSProperties = { fontSize: 10, color: 'var(--faint)' };

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
  // THE DOT (v0.663.1, founder: "a notification dot for new chats on the dev
  // chat chip"): unread is re-read every 15s and whenever the tab comes back.
  useEffect(() => {
    void read();
    const t = setInterval(() => { if (!document.hidden) void read(); }, 15_000);
    const back = () => { if (!document.hidden) void read(); };
    document.addEventListener('visibilitychange', back);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', back); };
  }, [read]);
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
        aria-label={unread > 0 ? `Dev room — ${unread} new` : 'Dev room'}
        style={{ position: 'fixed', left: 16, bottom: 16, zIndex: 71, display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer',
          fontSize: 11.5, fontWeight: 700, letterSpacing: '0.06em', color: open ? 'var(--on-accent, var(--bg))' : 'var(--you)',
          background: open ? 'var(--you)' : 'var(--surface)', border: '1px solid color-mix(in srgb, var(--you) 55%, var(--bd))',
          borderRadius: 999, padding: '9px 14px', boxShadow: '0 6px 18px rgba(0,0,0,0.25)' }}>
        🛠 {rooms.length ? 'DEV' : 'DEV ROOM'}
        {unread > 0 && !open && (
          <span aria-hidden style={{ position: 'absolute', top: -3, right: -3, width: 12, height: 12, borderRadius: '50%',
            background: 'var(--opp, #e5484d)', border: '2px solid var(--bg)' }} />
        )}
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
  const [admin, setAdmin] = useState(false);
  useEffect(() => {
    devRoomsMine().then((r) => { if (r.ok) setName(r.rooms?.find((x) => x.id === roomId)?.name ?? ''); }).catch(() => {});
    devRoomMembers(roomId).then((r) => { if (r.ok) setAdmin(!!r.admin); }).catch(() => {});
  }, [roomId]);
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: compact ? 14 : 18, fontWeight: 700, flex: 1 }}>{name}</span>
        <button onClick={() => setTab('chat')} className="mono" style={chip(tab === 'chat')}>CHAT</button>
        <button onClick={() => setTab('people')} className="mono" style={chip(tab === 'people')}>{admin ? 'PEOPLE' : 'WHO’S HERE'}</button>
      </div>
      {tab === 'people' ? <People roomId={roomId} roomName={name} onLeft={onLeft} /> : (
        // EVERY CHAT TOOL (v0.663.0): league chat's own thread on the room's
        // backend — pictures, GIFs, polls, reactions, @mentions, @computer.
        <div style={{ ...card, padding: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <DevChat roomId={roomId} height={compact ? '42vh' : '58vh'} />
        </div>
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
