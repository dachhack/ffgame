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
import { Ev, track } from '@drip/core/analytics';
import { mentionIds } from '@drip/core/data/mentions';
import { CHAT_REACTIONS, orderedReactions, reactionLabel, type ChatReactionCount } from '@drip/core/data/chatReactions';
import { useEffect, useRef, useState } from 'react';
import {
  chatPost, chatMessages, chatDelete, chatEdit, chatUnread, chatMembers, dmSend, dmThreads, dmMessages, dmEdit,
  chatPostPoll, pollCast, chatPin, chatReact, leagueReport, leagueWaiverRun,
  leagueNote, friendlyError,
  type ChatMessage, type DmThreadRow, type DmMessage,
} from '@drip/core/data/liveApi';
import { reportSections, type WeekReport } from '@drip/core/data/weekReport';
import { txnLook, txnBody, isWaiverRun, waiverRunLine, type WaiverRunReport } from '@drip/core/data/txnChat';
import { ModalBackdrop, Sheet } from './ui';
import { gifProvider, type GifResult } from '@drip/core/data/gifs';
import { CHAT_IMAGE_CAPTION_MAX, isChatImageUrl, removeChatImage, uploadChatImage } from '@drip/core/data/chatImage';
import { canEditDm, canEditMessage, editNote, editSeed, editTarget } from '@drip/core/data/chatEdit';
import { prepareChatImage, pastedImage, droppedImage } from './imagePost';

// ── chat v2 (0148): inline media, @mentions, polls, pins ────────────────────

/** Only these hosts (or bare image files) render inline — anything else stays
 *  text. Our own bucket (0349) leads the list: an upload is the one image URL
 *  we know the provenance of, and it is named first so it keeps rendering even
 *  if the extension ever leaves the path. */
const isImageUrl = (s: string): boolean => {
  const t = s.trim();
  if (!/^https?:\/\/\S+$/.test(t)) return false;
  return isChatImageUrl(t)
    || /^(https?:\/\/)(media\d*\.tenor\.com|media\d*\.giphy\.com|i\.giphy\.com|i\.imgur\.com)\//i.test(t)
    || /\.(gif|png|jpe?g|webp)(\?\S*)?$/i.test(t);
};
const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A message body: whole-URL images render inline; @TeamName tokens highlight
 *  against the league's real member names (longest name wins). */
function Body({ body, names }: { body: string; names: string[] }) {
  if (isImageUrl(body)) {
    // 200px tall in the thread, full size in a new tab — a screenshot of a
    // lineup is posted to be read, and 200px is not enough to read one.
    const src = body.trim();
    return (
      <a href={src} target="_blank" rel="noopener noreferrer" title="open full size"
        style={{ display: 'block', marginTop: 2 }}>
        <img src={src} alt="" loading="lazy"
          style={{ display: 'block', maxWidth: '100%', maxHeight: 200, borderRadius: 8 }} />
      </a>
    );
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

/** GIF search provider (0182.4): Tenor if VITE_TENOR_KEY is set, else Giphy
 *  via VITE_GIPHY_KEY; with neither the button hides (pasted GIF links still
 *  render inline). */
const GIF = gifProvider(
  (import.meta.env.VITE_TENOR_KEY as string | undefined) || undefined,
  (import.meta.env.VITE_GIPHY_KEY as string | undefined) || undefined,
);
function GifPicker({ onPick, onClose }: { onPick: (url: string) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [gifs, setGifs] = useState<GifResult[] | null>(null);
  useEffect(() => {
    if (!GIF) return;
    const t = setTimeout(() => {
      GIF.search(q).then(setGifs).catch(() => setGifs([]));
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
      <div className="mono" style={{ fontSize: 7.5, color: 'var(--faint)', marginTop: 6 }}>{GIF?.attribution}</div>
    </div>
  );
}

/** A poll message's options — tap to vote, tap another to change. */
// ── THE WEEKLY REPORT (v0.391.0) ────────────────────────────────────────────
// The house posts one line per week; the link on it opens the write-up in a
// pop-up. The payload is read on open (chat pages stay light) and rendered
// from core's reportSections so the app's sheet says the same things.
function ReportLine({ m, onOpen }: { m: ChatMessage; onOpen: () => void }) {
  const week = m.report?.week;
  return (
    <div style={{ borderLeft: '3px solid var(--warn)', padding: '4px 8px', background: 'color-mix(in srgb, var(--warn) 6%, transparent)', borderRadius: 4 }}>
      <div style={{ fontSize: 12.5, lineHeight: 1.45, color: 'var(--text)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{m.body}</div>
      <button onClick={onOpen} className="mono"
        style={{ marginTop: 4, fontSize: 9.5, fontWeight: 700, letterSpacing: '0.08em', cursor: 'pointer', borderRadius: 999, padding: '4px 10px', color: 'var(--warn)', background: 'var(--bg)', border: '1px solid var(--warn)' }}>
        📋 OPEN WEEK {week ?? '?'} REPORT ▸
      </button>
    </div>
  );
}

// ── THE WIRE (v0.405.0) ─────────────────────────────────────────────────────
// Founder: "we need an add/drop log... All this goes in chat." The house
// composes the sentence server-side (0290) so a push notification and a chat
// bubble read alike; this gives it a rail and a colour, so the league's own
// conversation still reads as the conversation and the moves read as the
// record rather than as somebody talking.
function TxnLine({ m, onOpenRun }: { m: ChatMessage; onOpenRun?: () => void }) {
  const look = txnLook(m.txn);
  const rail = look.tone === 'you' ? 'var(--you)' : look.tone === 'warn' ? 'var(--warn)' : 'var(--bd)';
  // 0344: a WAIVER RUN has a report behind it; every other txn kind is the
  // whole story already, and a button on one would promise a sheet that never
  // arrives.
  const openable = isWaiverRun(m.txn) && !!onOpenRun;
  const n = (m.txn?.won ?? 0) + (m.txn?.lost ?? 0);
  return (
    <div style={{ borderLeft: `3px solid ${rail}`, padding: '3px 8px', borderRadius: 4,
                  background: 'color-mix(in srgb, var(--dim) 7%, transparent)' }}>
      <div style={{ fontSize: 12.5, lineHeight: 1.45, color: 'var(--text)', overflowWrap: 'anywhere' }}>
        <span style={{ marginRight: 5 }}>{look.icon}</span>{txnBody(m.body, look)}
      </div>
      {openable && (
        <button onClick={onOpenRun} className="mono"
          style={{ marginTop: 4, marginBottom: 2, fontSize: 9.5, fontWeight: 700, letterSpacing: '0.08em', cursor: 'pointer', borderRadius: 999, padding: '4px 10px', color: 'var(--warn)', background: 'var(--bg)', border: '1px solid var(--warn)' }}>
          📋 OPEN THE RUN{n > 0 ? ` · ${n} CLAIM${n === 1 ? '' : 'S'}` : ''} ▸
        </button>
      )}
    </div>
  );
}

// ── THE RUN, IN FULL (0344) ─────────────────────────────────────────────────
// Founder: "can we have the daily waiver report be clickable in chat and open
// a detailed report?" The chat line is capped at 500 characters server-side,
// and it truncates at exactly the wrong end: the losers and their reasons are
// last in the sentence, and "why didn't I get him" is the only question a
// waiver report exists to answer. This is that end, uncut.
export function WaiverRunSheet({ leagueId, at, onClose }: { leagueId: string; at: string; onClose: () => void }) {
  const [rep, setRep] = useState<WaiverRunReport | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    leagueWaiverRun(leagueId, at)
      .then((r) => { if (!live) return; if (r?.ok) setRep(r); else setErr(friendlyError(r?.error ?? 'could not load the run')); })
      .catch((e) => { if (live) setErr(friendlyError(e)); });
    return () => { live = false; };
  }, [leagueId, at]);
  const mode = rep?.mode;
  const when = rep?.at ? new Date(rep.at) : new Date(at);
  const Group = ({ title, rows, tone }: { title: string; rows: WaiverRunReport['won']; tone: string }) => (
    <div style={{ marginTop: 12 }}>
      <div className="mono" style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--faint)', marginBottom: 4 }}>{title}</div>
      {(rows ?? []).length === 0
        ? <div className="mono" style={{ fontSize: 10.5, color: 'var(--faint)' }}>none</div>
        : (rows ?? []).map((e, i) => (
          <div key={`${e.roster_id}-${e.add_slug}-${i}`} style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '5px 0', borderTop: i ? '1px solid var(--bd)' : 'none' }}>
            <span className="mono" style={{ fontSize: 11.5, color: tone, flex: 1, lineHeight: 1.5 }}>{waiverRunLine(e, mode)}</span>
            {/* A LINKED GROUP (0316) stands or falls together — a loser whose
                partner failed is not the same story as one who was outbid. */}
            {e.group_id && (
              <span className="mono" title="part of a linked group — these claims stand or fall together"
                style={{ fontSize: 8.5, fontWeight: 700, color: 'var(--dim)', whiteSpace: 'nowrap' }}>
                ⛓ {e.group_seq ?? '?'}/{e.group_max ?? '?'}
              </span>
            )}
          </div>
        ))}
    </div>
  );
  return (
    <Sheet title="📋 The waiver run" subtitle={`${when.toLocaleString()}${mode ? ` · ${mode === 'faab' ? 'FAAB' : mode === 'standings' ? 'REVERSE STANDINGS' : 'ROLLING PRIORITY'}` : ''}`}
      max={620} zIndex={80} onClose={onClose}>
      {err && <div className="mono" style={{ fontSize: 11, color: 'var(--opp)' }}>{err}</div>}
      {!rep && !err && <div className="mono" style={{ fontSize: 11, color: 'var(--faint)' }}>loading…</div>}
      {rep?.found === false && (
        <div className="mono" style={{ fontSize: 11, color: 'var(--faint)', lineHeight: 1.6 }}>
          No claims are on file for this run any more. The line above is still what happened; the detail behind it has been cleaned up.
        </div>
      )}
      {rep?.found && (<>
        <Group title="WON" rows={rep.won} tone="var(--you)" />
        <Group title="DID NOT GO THROUGH" rows={rep.lost} tone="var(--dim)" />
        {!!rep.order?.length && (
          <div style={{ marginTop: 14, borderTop: '1px solid var(--bd)', paddingTop: 10 }}>
            <div className="mono" style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--faint)', marginBottom: 4 }}>
              THE WIRE NOW{mode === 'faab' ? ' · BUDGET LEFT' : ' · PRIORITY'}
            </div>
            {rep.order.map((o, i) => (
              <div key={o.roster_id} style={{ display: 'flex', gap: 8, padding: '3px 0', borderTop: i ? '1px solid var(--bd)' : 'none' }}>
                <span className="mono" style={{ fontSize: 10, color: 'var(--faint)', width: 18 }}>{o.priority ?? i + 1}</span>
                <span className="mono" style={{ fontSize: 11, color: 'var(--text)', flex: 1 }}>{o.team ?? `Roster ${o.roster_id}`}</span>
                {o.faab != null && <span className="mono" style={{ fontSize: 11, fontWeight: 700, color: 'var(--dim)' }}>${o.faab}</span>}
              </div>
            ))}
          </div>
        )}
      </>)}
    </Sheet>
  );
}

export function ReportSheet({ leagueId, week, onClose }: { leagueId: string; week: number; onClose: () => void }) {
  const [rep, setRep] = useState<WeekReport | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    leagueReport(leagueId, week)
      .then((r) => { if (!live) return; if (r.ok && r.report) setRep(r.report); else setErr(friendlyError(r.error ?? 'No report yet.')); })
      .catch((x) => { if (live) setErr(friendlyError(x)); });
    return () => { live = false; };
  }, [leagueId, week]);
  const sections = rep ? reportSections(rep) : [];
  return (
    // zIndex 80: the chat panel is a ModalBackdrop at 70, and a Sheet's default
    // 60 opened BEHIND it (founder, mobile web: "the weekly report is behind
    // the chat").
    <Sheet title={`📋 Week ${week} report`} subtitle={rep ? `${rep.league.toUpperCase()} · ${rep.format.toUpperCase()}` : 'LOADING'} onClose={onClose} max={520} zIndex={80}>
      <div style={{ padding: '10px 15px 16px', overflowY: 'auto' }}>
        {err && <div className="mono" style={{ fontSize: 10, color: 'var(--opp)' }}>{err}</div>}
        {!err && !rep && <div className="mono" style={{ fontSize: 10, color: 'var(--faint)' }}>Loading…</div>}
        {rep && <div style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--text)', marginBottom: 12 }}>{rep.headline}</div>}
        {sections.map((sec) => (
          <div key={sec.title} style={{ marginBottom: 14 }}>
            <div className="mono" style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.14em', color: 'var(--faint)', marginBottom: 5 }}>{sec.title.toUpperCase()}</div>
            {sec.rows.map((r, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '4px 0', borderTop: i ? '1px solid var(--bd)' : 'none' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: r.hot ? 700 : 500, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</div>
                  {r.sub && <div className="mono" style={{ fontSize: 8.5, color: 'var(--dim)', marginTop: 1 }}>{r.sub}</div>}
                </div>
                <div className="mono" style={{ fontSize: 11.5, fontWeight: 700, color: r.hot ? 'var(--warn)' : 'var(--text)', flex: 'none', fontVariantNumeric: 'tabular-nums' }}>{r.value}</div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </Sheet>
  );
}

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

const card: React.CSSProperties = { background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 8, padding: 0, width: '100%', maxWidth: 440, height: 'min(560px, 86vh)',
  // `maxHeight: 100%` is the half that keeps the COMPOSER on screen (v0.327.0).
  // ModalBackdrop now sizes itself to the visual viewport when the keyboard is
  // up, but `86vh` is measured against the LAYOUT viewport, which the keyboard
  // does not shrink — so without this the card stayed full-height inside a
  // third-height backdrop and its bottom row, the message box, sat under the
  // keys. With it, the flex column compresses and the composer rides the
  // bottom of whatever is actually visible.
  maxHeight: '100%',
  display: 'flex', flexDirection: 'column', boxSizing: 'border-box', overflow: 'hidden' };
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
/** `compact` (v0.290.0, founder: "make the chat just the icon") — the speech
 *  bubble alone, with unread as a DOT rather than a count. The word bought
 *  nothing the bubble does not already say, and on a phone the board's tool row
 *  is the widest thing on the screen. Same trade the app's chip made in
 *  v0.279.3; the count still reaches you inside the panel. */
export function ChatButton({ leagueId, style, compact = false }: { leagueId: string; style?: React.CSSProperties; compact?: boolean }) {
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
      <button onClick={() => setOpen(true)} className="mono"
        style={compact ? { position: 'relative', ...style } : style}
        aria-label={compact ? 'Chat' : undefined}
        title={mentioned ? 'someone mentioned you' : 'league chat + direct messages'}>
        {compact ? (
          <>
            <span style={{ fontSize: '1.35em', lineHeight: 1 }}>💬</span>
            {/* Tier-2 CVD audit (v0.379.1): mention-vs-unread was the ONE spot
                in either host where two meanings differed by color alone — the
                same 8px dot in opp-red or you-green. A mention now wears the
                @ itself; the plain dot keeps its single meaning, unread. */}
            {unread > 0 && (mentioned
              ? <span aria-hidden style={{ position: 'absolute', top: -5, right: -5, minWidth: 11, height: 11, borderRadius: 999, background: 'var(--opp)', color: 'var(--on-accent)', fontSize: 8, fontWeight: 800, lineHeight: '11px', textAlign: 'center', padding: '0 1px' }}>@</span>
              : <span aria-hidden style={{ position: 'absolute', top: -3, right: -3, width: 8, height: 8, borderRadius: 999, background: 'var(--you)' }} />)}
          </>
        ) : (
          <>💬 CHAT{mentioned ? ' @' : ''}{unread > 0 ? ` · ${unread > 99 ? '99+' : unread}` : ''}</>
        )}
      </button>
      {open && <ChatPanel leagueId={leagueId} onClose={() => { setOpen(false); setUnread(0); setMentioned(false); }} />}
    </>
  );
}

export function ChatPanel({ leagueId, onClose }: { leagueId: string; onClose: () => void }) {
  const [tab, setTab] = useState<'league' | 'dm'>('league');
  const [canModerate, setCanModerate] = useState(false);
  useEffect(() => { leagueNote(leagueId).then((r) => setCanModerate(!!r.can_edit)).catch(() => {}); }, [leagueId]);
  useEffect(() => { track(Ev.chatOpened, { dm: tab === 'dm' }); }, [tab]);
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
function MessageScroll({ children, dep, onFile }: { children: React.ReactNode; dep: unknown; onFile?: (f: File | null) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  // 0349: dragging a picture onto the conversation posts it. The outline only
  // appears while something is actually over the thread, so the chat does not
  // grow a dashed box it never uses.
  const [over, setOver] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [dep]);
  return (
    <div ref={ref} onScroll={(e) => {
      const el = e.currentTarget;
      stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    }}
      onDragOver={onFile ? (e) => { e.preventDefault(); setOver(true); } : undefined}
      onDragLeave={onFile ? () => setOver(false) : undefined}
      onDrop={onFile ? (e) => { e.preventDefault(); setOver(false); onFile(droppedImage(e)); } : undefined}
      style={{ flex: 1, overflowY: 'auto', padding: '10px 14px', minHeight: 0,
        ...(over ? { outline: '2px dashed var(--you)', outlineOffset: -4 } : {}) }}>
      {children}
    </div>
  );
}

// ── POSTING A PICTURE (0349, captions 0350) ─────────────────────────────────
// Founder: "I want to allow users to post images in the chat." Then: "it posts
// instantly after picking. Allow the user to caption the image so they can QC
// and add any text."
//
// So picking opens a DRAFT rather than sending: the picture at a size you can
// actually check, a caption box, and two buttons. All three ways in (the 📷
// button, a paste, a drop) land in the same draft, on both surfaces.
//
// NOTHING UPLOADS UNTIL SEND. The bytes sit in the browser while the draft is
// open, so a picture you changed your mind about never reaches the bucket —
// which is also why discarding costs nothing and needs no cleanup.
//
// THE CAPTION RIDES BESIDE THE BODY, not inside it (0350): the body of an
// image message stays the bare URL, because inline rendering keys on exactly
// that and every build already out there would print a link instead.
//
// AND IT STILL CLEANS UP AFTER ITSELF. If the upload lands but the message
// does not (a flood guard, a dropped connection), the file is removed again
// and the draft stays open to try again.
interface ImageDraftState { blob: Blob; type: string; preview: string }
function useImagePost(leagueId: string, post: (body: string, caption: string | null) => Promise<boolean>) {
  const [pending, setPending] = useState<ImageDraftState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // An object URL is a live handle, not a string: dropping one without
  // revoking it keeps the whole image in memory for the life of the tab.
  const clear = () => setPending((cur) => { if (cur) URL.revokeObjectURL(cur.preview); return null; });
  useEffect(() => () => { if (pending) URL.revokeObjectURL(pending.preview); }, [pending]);
  const pick = async (file: File | null | undefined) => {
    if (!file || busy) return;
    setError(null);
    try {
      const ready = await prepareChatImage(file);
      if (!ready.ok) { setError(ready.error); return; }
      clear();
      setPending({ blob: ready.blob, type: ready.type, preview: URL.createObjectURL(ready.blob) });
    } catch (x) { setError(friendlyError(x)); }
  };
  const confirm = async (caption: string) => {
    if (!pending || busy) return;
    setError(null); setBusy(true);
    try {
      const up = await uploadChatImage(leagueId, pending.blob, pending.type);
      if (!up.ok || !up.url) { setError(friendlyError(up.error ?? 'Could not upload that image.')); return; }
      if (await post(up.url, caption.trim() || null)) clear();
      else await removeChatImage(up.url);
    } catch (x) { setError(friendlyError(x)); }
    finally { setBusy(false); }
  };
  return { pick, pending, busy, error, confirm, cancel: () => { setError(null); clear(); } };
}

/** THE DRAFT: the picture as it will post, the words to go with it, and the
 *  two decisions. Deliberately in the panel rather than a modal — the message
 *  list stays visible, which is half of what "does this belong here" is. */
function ImageDraft({ src, busy, initialCaption, onSend, onCancel }: {
  src: string; busy: boolean; initialCaption: string;
  onSend: (caption: string) => void; onCancel: () => void;
}) {
  const [caption, setCaption] = useState(initialCaption);
  return (
    <div style={{ borderTop: '1px solid var(--bd)', background: 'var(--surface)', padding: '8px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <span className="mono" style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--dim)' }}>SEND THIS PICTURE?</span>
        <button onClick={onCancel} disabled={busy} className="mono" style={{ ...linkBtn, fontSize: 9 }} title="discard">✕ DISCARD</button>
      </div>
      <img src={src} alt="" style={{ display: 'block', maxWidth: '100%', maxHeight: 180, borderRadius: 8, margin: '0 auto 8px', objectFit: 'contain' }} />
      <div style={{ display: 'flex', gap: 6 }}>
        <input value={caption} autoFocus maxLength={CHAT_IMAGE_CAPTION_MAX} onChange={(e) => setCaption(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !busy) onSend(caption); }}
          placeholder="say something about it… (optional)" style={{ ...input, fontSize: 12.5 }} />
        <button onClick={() => onSend(caption)} disabled={busy} className="mono"
          style={{ ...btn, padding: '9px 16px', opacity: busy ? 0.5 : 1 }}>{busy ? '…' : '➤'}</button>
      </div>
    </div>
  );
}

/** THE + MENU (v0.487.0). Founder: "Let's do a + button that lets you then
 *  select poll, image, gif." 📊, GIF and 📷 had become a row of buttons eating
 *  the input's width; they live behind one + now, and each choice opens what
 *  its old button opened. Poll stays the commissioner's — the server's rule. */
function PlusMenu({ canPoll, canGif, onPick, onClose }: {
  canPoll: boolean; canGif: boolean; onPick: (what: 'poll' | 'image' | 'gif') => void; onClose: () => void;
}) {
  const item = (what: 'poll' | 'image' | 'gif', icon: string, label: string) => (
    <button key={what} onClick={() => onPick(what)} className="mono"
      style={{ ...linkBtn, display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '8px 4px', fontSize: 10.5, color: 'var(--text)', textAlign: 'left' }}>
      <span style={{ fontSize: 15, width: 22, textAlign: 'center' }}>{icon}</span>{label}
    </button>
  );
  return (
    <div style={{ borderTop: '1px solid var(--bd)', padding: '6px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <div className="mono" style={{ flex: 1, fontSize: 9, letterSpacing: '0.12em', color: 'var(--dim)', fontWeight: 700 }}>ADD TO CHAT</div>
        <button onClick={onClose} className="mono" style={linkBtn} title="close">✕</button>
      </div>
      {canPoll && item('poll', '📊', 'POLL')}
      {item('image', '📷', 'IMAGE')}
      {canGif && item('gif', '🎞', 'GIF')}
    </div>
  );
}

/** The 📷 in a composer: a hidden file input and the button that opens it. */
function ImageButton({ onPick, busy }: { onPick: (f: File | null) => void; busy: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={ref} type="file" accept="image/png,image/jpeg,image/gif,image/webp" style={{ display: 'none' }}
        onChange={(e) => { onPick(e.target.files?.[0] ?? null); e.target.value = ''; }} />
      <button onClick={() => ref.current?.click()} disabled={busy} className="mono"
        title="post a picture" aria-label="post a picture"
        style={{ ...linkBtn, fontSize: 13, padding: '0 2px', alignSelf: 'center', opacity: busy ? 0.5 : 1 }}>
        {busy ? '…' : '📷'}
      </button>
    </>
  );
}

/** THE EDITOR (0351): the message's own words, in place, with the two
 *  decisions beside them. In place rather than in the composer — a correction
 *  belongs where the sentence is, and the conversation above it stays put. */
function EditBox({ m, onSave, onCancel }: {
  m: { body: string; caption?: string | null };
  /** Returns an error to show, or null once it has saved and reloaded. */
  onSave: (body: string, caption: string | null) => Promise<string | null>;
  onCancel: () => void;
}) {
  const [text, setText] = useState(editSeed(m));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const target = editTarget(m);
  const save = async () => {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      const body = target === 'caption' ? m.body : text.trim();
      const caption = target === 'caption' ? text.trim() || null : (m.caption ?? null);
      setErr(await onSave(body, caption));
    } catch (x) { setErr(friendlyError(x)); }
    finally { setBusy(false); }
  };
  return (
    <div style={{ marginTop: 2 }}>
      {target === 'caption' && <Body body={m.body} names={[]} />}
      <div style={{ display: 'flex', gap: 6, marginTop: 3 }}>
        <input value={text} autoFocus maxLength={target === 'caption' ? CHAT_IMAGE_CAPTION_MAX : 500}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void save(); if (e.key === 'Escape') onCancel(); }}
          placeholder={target === 'caption' ? 'say something about it…' : 'say it again…'}
          style={{ ...input, fontSize: 12.5 }} />
        <button onClick={() => void save()} disabled={busy} className="mono"
          style={{ ...btn, padding: '7px 12px', opacity: busy ? 0.5 : 1 }}>SAVE</button>
        <button onClick={onCancel} disabled={busy} className="mono" style={{ ...linkBtn, fontSize: 9 }}>CANCEL</button>
      </div>
      {err && <div className="mono" style={{ fontSize: 9.5, color: 'var(--opp)', marginTop: 4 }}>{err}</div>}
    </div>
  );
}

/** "edited by Taco Time Titans" — the name, because the case worth surfacing is
 *  somebody ELSE having reworded you. */
function EditedNote({ m }: { m: { edited_at?: string | null; edited_by?: string | null } }) {
  const note = editNote(m);
  if (!note) return null;
  return (
    <span className="mono" title={m.edited_at ? new Date(m.edited_at).toLocaleString() : undefined}
      style={{ fontSize: 8, color: 'var(--faint)', fontStyle: 'italic', marginLeft: 4 }}>
      · {note}
    </span>
  );
}

/** QUICK REACTIONS on one message (v0.329.0).
 *
 *  Founder: "can we have quick reactions in chat..Like thumbs up, agree, fire,
 *  surprise etc."
 *
 *  WHAT IS SHOWN WHEN vs WHAT CAN BE ADDED. A message with reactions shows
 *  them, always, because the counts are the content — that is what a reaction
 *  is for. The six-chip PICKER is behind a `+`, because six always-on chips
 *  under every message would be more furniture than chat.
 *
 *  OPTIMISTIC, and it has to be. `chat_react` returns the message's whole new
 *  reaction set, so a tap repaints one message rather than refetching the page
 *  — a chat that reloads on every tap scrolls away from the thing you were
 *  reacting to. On failure the server's answer is simply not applied.
 */
function Reactions({ m, leagueId, onChange }: {
  m: ChatMessage; leagueId: string; onChange: (id: number, r: ChatReactionCount[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const shown = orderedReactions(m.reactions);
  const react = async (emoji: string) => {
    if (busy) return;
    setBusy(true); setOpen(false);
    try {
      const r = await chatReact(leagueId, m.id, emoji);
      if (r.ok && r.reactions) onChange(m.id, r.reactions);
    } catch { /* the counts simply do not move */ }
    finally { setBusy(false); }
  };
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center', marginTop: 4 }}>
      {shown.map((r) => (
        <button key={r.emoji} onClick={() => void react(r.emoji)} disabled={busy}
          aria-label={`${reactionLabel(r.emoji)} — ${r.n}${r.mine ? ', including you' : ''}`}
          aria-pressed={r.mine}
          title={reactionLabel(r.emoji)}
          className="mono"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 3, cursor: 'pointer',
            fontSize: 10, lineHeight: 1.4, borderRadius: 999, padding: '1px 7px',
            border: `1px solid ${r.mine ? 'var(--you)' : 'var(--bd)'}`,
            background: r.mine ? 'color-mix(in srgb, var(--you) 14%, transparent)' : 'var(--bg)',
            color: r.mine ? 'var(--you)' : 'var(--dim)',
          }}>
          <span style={{ fontSize: 11 }}>{r.emoji}</span>{r.n}
        </button>
      ))}
      <button onClick={() => setOpen((v) => !v)} aria-label="add a reaction" title="add a reaction" className="mono"
        style={{ cursor: 'pointer', fontSize: 10, lineHeight: 1.4, borderRadius: 999, padding: '1px 7px',
          border: '1px solid var(--bd)', background: 'var(--bg)', color: 'var(--faint)' }}>
        {open ? '×' : '+'}
      </button>
      {open && CHAT_REACTIONS.map((r) => (
        <button key={r.emoji} onClick={() => void react(r.emoji)} disabled={busy}
          aria-label={r.label} title={r.label}
          style={{ cursor: 'pointer', fontSize: 13, lineHeight: 1.2, borderRadius: 999, padding: '1px 5px',
            border: '1px solid var(--you)', background: 'var(--bg)' }}>
          {r.emoji}
        </button>
      ))}
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
  const [reportWeek, setReportWeek] = useState<number | null>(null);
  // 0344: which waiver run's sheet is up, keyed by the message's own timestamp
  // — which IS the run's, since the claims and the line share a transaction.
  const [runAt, setRunAt] = useState<string | null>(null);
  const [gifOpen, setGifOpen] = useState(false);
  const [plusOpen, setPlusOpen] = useState(false);
  // The + menu's IMAGE choice needs a file input to click; it is this one.
  const fileRef = useRef<HTMLInputElement>(null);
  /** 0351: the one message being reworded, if any. */
  const [editing, setEditing] = useState<number | null>(null);
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
  const sendBody = async (body: string, caption: string | null = null): Promise<boolean> => {
    if (!body || busy) return false;
    setBusy(true); setErr(null);
    try {
      // mentions travel as ids, derived from the @names still present at send
      // @all (v0.327.0) — the rule lives in core/data/mentions so this and the
      // native app cannot drift on which "@all"s are real ones.
      // 0350: a caption is where the @name usually is on a picture, so it is
      // read for mentions the same as the body.
      const mentions = mentionIds(caption ? `${body} ${caption}` : body, members);
      const r = await chatPost(leagueId, body, mentions, caption);
      if (!r.ok) { setErr(friendlyError(r.error ?? 'Could not send.')); return false; }
      setDraft(''); setGifOpen(false); await load();
      return true;
    } catch (x) { setErr(friendlyError(x)); return false; }
    finally { setBusy(false); }
  };
  const img = useImagePost(leagueId, sendBody);
  // Repaint ONE message's reactions in place (v0.329.0). Not `load()`: the
  // 8-second poll already refreshes the page, and refetching on every tap
  // would yank the scroll position away from the message being reacted to.
  const applyReactions = (id: number, reactions: ChatReactionCount[]) => {
    setMsgs((cur) => (cur ?? []).map((m) => (m.id === id ? { ...m, reactions } : m)));
    setPins((cur) => cur.map((m) => (m.id === id ? { ...m, reactions } : m)));
  };
  // 0349: the line and the picture go together. The storage policy lets the
  // author and the commissioner through — the same two chat_delete just let
  // through — so a moderated image stops being on the internet, not just in the
  // thread. A GIF or a pasted link is somebody else's file; removeChatImage
  // ignores anything that is not ours.
  const del = async (m: ChatMessage) => {
    try {
      const r = await chatDelete(leagueId, m.id);
      if (!r.ok) { setErr(friendlyError(r.error ?? '')); return; }
      await removeChatImage(m.body);
      await load();
    } catch (x) { setErr(friendlyError(x)); }
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
  // @all rides the same row (v0.327.0). A mention nobody can discover is a
  // feature only the person who built it uses — it offers itself the moment an
  // `@` is typed, and stops once it has been completed.
  const suggAll = mq != null && mq.length <= 3 && 'all'.startsWith(mq.toLowerCase()) && mq.toLowerCase() !== 'all'
    && members.some((m) => !m.me);

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
                {p.kind === 'poll' ? `📊 ${p.body}`
                  : isChatImageUrl(p.body) ? (p.caption ? `🖼 ${p.caption}` : '🖼 IMAGE')
                  : isImageUrl(p.body) ? '🖼 GIF' : p.body}
              </span>
              {canModerate && (
                <button onClick={() => void pin(p.id, false)} className="mono" style={{ ...linkBtn, fontSize: 8.5, padding: 0 }} title="unpin">✕</button>
              )}
            </div>
          ))}
        </div>
      )}
      <MessageScroll dep={msgs?.length ?? 0} onFile={img.pick}>
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
              {canEditMessage(m, canModerate) && (
                <button onClick={() => setEditing(editing === m.id ? null : m.id)} className="mono"
                  title={m.mine ? 'edit' : 'edit as commissioner — your name goes on it'}
                  style={{ ...linkBtn, fontSize: 9, padding: '0 2px' }}>✎</button>
              )}
              {(m.mine || canModerate) && (
                <button onClick={() => void del(m)} className="mono" style={{ ...linkBtn, fontSize: 9, color: 'var(--opp)', padding: '0 2px' }}>✕</button>
              )}
              <EditedNote m={m} />
            </div>
            {editing === m.id
              ? <EditBox m={m} onCancel={() => setEditing(null)}
                  onSave={async (body, caption) => {
                    // The new words are where the @names are now, so mentions
                    // come off the edit rather than off what it replaced.
                    const r = await chatEdit(leagueId, m.id, body,
                      mentionIds([body, caption].filter(Boolean).join(' '), members), caption);
                    if (!r.ok) return friendlyError(r.error ?? 'Could not save that.');
                    setEditing(null); await load();
                    return null;
                  }} />
              : m.kind === 'txn'
              ? <TxnLine m={m} onOpenRun={isWaiverRun(m.txn) ? () => setRunAt(m.at) : undefined} />
              : m.kind === 'report'
              ? <ReportLine m={m} onOpen={() => setReportWeek(m.report?.week ?? null)} />
              : m.kind === 'poll'
              ? <>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)' }}>📊 {m.body}</div>
                  <PollView m={m} leagueId={leagueId} onVoted={() => void load()} />
                </>
              : <div style={{ fontSize: 12.5, lineHeight: 1.45, color: 'var(--text)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                  <Body body={m.body} names={names} />
                  {/* 0350: the words under the picture, mentions and all. */}
                  {!!m.caption && <div style={{ marginTop: 3 }}><Body body={m.caption} names={names} /></div>}
                </div>}
            <Reactions m={m} leagueId={leagueId} onChange={applyReactions} />
          </div>
        ))}
      </MessageScroll>
      {pollOpen && <PollComposer leagueId={leagueId} onDone={() => { setPollOpen(false); void load(); }} onClose={() => setPollOpen(false)} />}
      {reportWeek != null && <ReportSheet leagueId={leagueId} week={reportWeek} onClose={() => setReportWeek(null)} />}
      {runAt != null && <WaiverRunSheet leagueId={leagueId} at={runAt} onClose={() => setRunAt(null)} />}
      {gifOpen && GIF && <GifPicker onPick={(url) => void sendBody(url)} onClose={() => setGifOpen(false)} />}
      {plusOpen && (
        <PlusMenu canPoll={canModerate} canGif={!!GIF} onClose={() => setPlusOpen(false)}
          onPick={(what) => {
            setPlusOpen(false); setPollOpen(false); setGifOpen(false);
            if (what === 'poll') setPollOpen(true);
            else if (what === 'gif') setGifOpen(true);
            else fileRef.current?.click();
          }} />
      )}
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0] ?? null; e.target.value = ''; if (f) void img.pick(f); }} />
      {img.pending && (
        <ImageDraft src={img.pending.preview} busy={img.busy} initialCaption={draft}
          onSend={(c) => void img.confirm(c)} onCancel={img.cancel} />
      )}
      <div style={{ borderTop: '1px solid var(--bd)', padding: '10px 14px' }}>
        {(err ?? img.error) && <div className="mono" style={{ fontSize: 9.5, color: 'var(--opp)', marginBottom: 6 }}>{err ?? img.error}</div>}
        {img.busy && <div className="mono" style={{ fontSize: 9.5, color: 'var(--faint)', marginBottom: 6 }}>Uploading your picture…</div>}
        {(sugg.length > 0 || suggAll) && (
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 6 }}>
            {suggAll && (
              <button onClick={() => setDraft(draft.slice(0, at) + '@all ')} className="mono"
                title="mention everyone in the league"
                style={{ fontSize: 9, fontWeight: 700, cursor: 'pointer', borderRadius: 999, padding: '3px 9px', color: 'var(--warn)', background: 'var(--bg)', border: '1px solid var(--warn)' }}>
                @all
              </button>
            )}
            {sugg.map((s) => (
              <button key={s.id} onClick={() => setDraft(draft.slice(0, at) + '@' + s.name + ' ')} className="mono"
                style={{ fontSize: 9, fontWeight: 700, cursor: 'pointer', borderRadius: 999, padding: '3px 9px', color: 'var(--you)', background: 'var(--bg)', border: '1px solid var(--you)' }}>
                @{s.name}
              </button>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: 6 }}>
          {(() => {
            const up = plusOpen || pollOpen || gifOpen || !!img.pending;
            return (
              <button disabled={img.busy}
                onClick={() => { if (up) { setPlusOpen(false); setPollOpen(false); setGifOpen(false); img.cancel(); } else setPlusOpen(true); }}
                title={up ? 'close' : 'add a poll, image or GIF'} aria-label={up ? 'close' : 'add a poll, image or GIF'}
                style={{ flex: 'none', width: 34, height: 34, alignSelf: 'center', borderRadius: '50%', border: '1px solid var(--bd)', background: 'var(--bg)', color: up ? 'var(--you)' : 'var(--dim)', fontSize: 18, lineHeight: 1, cursor: 'pointer', padding: 0, opacity: img.busy ? 0.5 : 1 }}>
                {img.busy ? '…' : up ? '×' : '+'}
              </button>
            );
          })()}
          <input value={draft} maxLength={500} onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !sugg.length && !suggAll) void sendBody(draft.trim()); }}
            onPaste={(e) => { const f = pastedImage(e); if (f) { e.preventDefault(); void img.pick(f); } }}
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

function Composer({ draft, setDraft, busy, err, onSend, placeholder, image }: {
  draft: string; setDraft: (v: string) => void; busy: boolean; err: string | null; onSend: () => void; placeholder: string;
  /** 0349: the picture path, when this surface has one. */
  image?: {
    pick: (f: File | null) => void; busy: boolean; error: string | null;
    pending: { preview: string } | null; confirm: (caption: string) => void; cancel: () => void;
  };
}) {
  return (
    <>
    {image?.pending && (
      <ImageDraft src={image.pending.preview} busy={image.busy} initialCaption={draft}
        onSend={image.confirm} onCancel={image.cancel} />
    )}
    <div style={{ borderTop: '1px solid var(--bd)', padding: '10px 14px' }}>
      {(err ?? image?.error) && <div className="mono" style={{ fontSize: 9.5, color: 'var(--opp)', marginBottom: 6 }}>{err ?? image?.error}</div>}
      {image?.busy && <div className="mono" style={{ fontSize: 9.5, color: 'var(--faint)', marginBottom: 6 }}>Uploading your picture…</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        {image && <ImageButton onPick={image.pick} busy={image.busy} />}
        <input value={draft} maxLength={500} onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') onSend(); }}
          onPaste={image ? (e) => { const f = pastedImage(e); if (f) { e.preventDefault(); image.pick(f); } } : undefined}
          placeholder={placeholder} style={{ ...input, fontSize: 12.5 }} />
        <button onClick={onSend} disabled={busy || !draft.trim()} className="mono"
          style={{ ...btn, padding: '9px 16px', opacity: busy || !draft.trim() ? 0.5 : 1 }}>➤</button>
      </div>
    </div>
    </>
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
                  {t.preview && <span className="mono" style={{ display: 'block', fontSize: 9.5, color: 'var(--faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {/* the preview is the body's first 80 characters, so an image
                        message would read as half a URL (0349). */}
                    {isChatImageUrl(t.preview) ? '🖼 Picture' : isImageUrl(t.preview) ? '🖼 GIF' : t.preview}
                  </span>}
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
  /** 0351: the one message being reworded. Yours only — a DM has no
   *  commissioner, so there is nobody else an edit could come from. */
  const [editing, setEditing] = useState<number | null>(null);
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
  const sendBody = async (body: string, caption: string | null = null): Promise<boolean> => {
    if (!body || busy) return false;
    setBusy(true); setErr(null);
    try {
      const r = await dmSend(leagueId, thread.peerId, body, caption);
      if (!r.ok) { setErr(friendlyError(r.error ?? 'Could not send.')); return false; }
      setDraft('');
      if (r.thread_id) { if (!thread.threadId) onThreadId(r.thread_id); await load(r.thread_id); }
      return true;
    } catch (x) { setErr(friendlyError(x)); return false; }
    finally { setBusy(false); }
  };
  const img = useImagePost(leagueId, sendBody);
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderBottom: '1px solid var(--bd)' }}>
        <button onClick={onBack} className="mono" style={linkBtn}>←</button>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)' }}>{thread.peer}</span>
      </div>
      <MessageScroll dep={msgs?.length ?? 0} onFile={img.pick}>
        {msgs == null && <div className="mono" style={{ fontSize: 10, color: 'var(--faint)' }}>Loading…</div>}
        {msgs?.length === 0 && <div className="mono" style={{ fontSize: 10, color: 'var(--faint)' }}>Say hello.</div>}
        {msgs?.map((m) => (
          <div key={m.id} style={{ display: 'flex', justifyContent: m.mine ? 'flex-end' : 'flex-start', marginBottom: 8 }}>
            <div style={{ maxWidth: '78%', borderRadius: 10, padding: '7px 11px', background: m.mine ? 'color-mix(in srgb, var(--you) 18%, var(--surface))' : 'var(--bg)', border: '1px solid var(--bd)' }}>
              {editing === m.id ? (
                <EditBox m={m} onCancel={() => setEditing(null)}
                  onSave={async (body, caption) => {
                    if (!thread.threadId) return null;
                    const r = await dmEdit(thread.threadId, m.id, body, caption);
                    if (!r.ok) return friendlyError(r.error ?? 'Could not save that.');
                    setEditing(null); await load(thread.threadId);
                    return null;
                  }} />
              ) : (
                <div style={{ fontSize: 12.5, lineHeight: 1.45, color: 'var(--text)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                  <Body body={m.body} names={[]} />
                  {!!m.caption && <div style={{ marginTop: 3 }}><Body body={m.caption} names={[]} /></div>}
                </div>
              )}
              <div className="mono" style={{ fontSize: 7.5, color: 'var(--faint)', marginTop: 2, textAlign: m.mine ? 'right' : 'left' }}>
                {canEditDm(m) && editing !== m.id && (
                  <button onClick={() => setEditing(m.id)} className="mono" title="edit"
                    style={{ ...linkBtn, fontSize: 9, padding: '0 4px 0 0', color: 'var(--faint)' }}>✎</button>
                )}
                {fmtWhen(m.at)}<EditedNote m={m} />
              </div>
            </div>
          </div>
        ))}
      </MessageScroll>
      <Composer draft={draft} setDraft={setDraft} busy={busy} err={err} onSend={() => void sendBody(draft.trim())}
        placeholder={`message ${thread.peer}…`}
        image={{ pick: (f) => void img.pick(f), busy: img.busy, error: img.error,
          pending: img.pending, confirm: (c) => void img.confirm(c), cancel: img.cancel }} />
    </>
  );
}
