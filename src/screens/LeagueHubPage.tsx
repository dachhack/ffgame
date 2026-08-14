// League home (v0.182.0) — the per-league hub between "Your leagues" and the
// board. Clicking a league now lands HERE; the matchup is one tile (and one
// quick-link on the league card) away, and everything else a league offers —
// trades, waivers, the note, the shop, other matchups, other rosters, chat,
// team options, the commissioner's desk — hangs off the same page instead of
// being scattered behind the board and the team screen.
//
// Deliberately inside LiveOnboard's view machine (not a route): the whole
// signed-in area works that way, and a hub needs the Enrollment object the
// home already holds — a cold-loadable #/hub/:id route can come later.
//
// (Not to be confused with screens/LeagueHub.tsx, the demo-era portfolio.)
import { useEffect, useState } from 'react';
import { useStore } from '../app/store';
import { Img } from '../app/ui';
import {
  myMatchup, defaultOpenWeek, matchupTeams, leagueNote, chatUnread, nativeRosters, leaguePool,
  type Enrollment, type LiveMatchup, type TeamInfo,
} from '@drip/core/data/liveApi';
import { buildLiveLeague } from '@drip/core/data/liveBoard';
import { PRESEASON_BASE, weekLabel } from '@drip/core/data/nflSlate';
import { GameIcon, BRAND_MARK } from '../app/gameIcons';
import { ChatPanel } from '../app/chat';

// ── one-shot board intent ───────────────────────────────────────────────────
// The shop lives on the board (it needs liveCtx + wallet). The hub's SHOP tile
// builds the board and leaves this flag; Matchup consumes it on mount and
// opens the shop. Module-level like the engine caches — one board at a time.
let pendingShop = false;
export const requestShopOnBoard = (): void => { pendingShop = true; };
export const consumeShopOnBoard = (): boolean => { const v = pendingShop; pendingShop = false; return v; };

/** Build this enrollment's live board and enter it — the exact prelude
 *  LeagueCard's SET YOUR LINEUP runs (kept in sync by hand; the card keeps
 *  its own copy so the hub can't regress it). */
export function useHeroBoard(e: Enrollment, userId: string) {
  const { loadSimLeague, navigate } = useStore();
  const [building, setBuilding] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const play = async (intent?: 'shop') => {
    if (building) return;
    setBuilding(true); setErr(null);
    try {
      const preseasonOn = !!e.league?.preseason_at;
      const week = await defaultOpenWeek(e.league_id, e.league?.season ?? '2026', preseasonOn)
        .catch(() => (preseasonOn ? PRESEASON_BASE + 1 : 1));
      const m = await myMatchup(e.league_id, e.sleeper_roster_id, week).catch(() => null);
      const { built, youTeamId } = await buildLiveLeague(e.league_id, e.sleeper_roster_id, week);
      const ctx = m ? { matchupId: m.id, userId: e.pick_user_id ?? userId, leagueId: e.league_id, rosterId: e.sleeper_roster_id, week: m.week } : null;
      loadSimLeague(built, youTeamId, ctx);
      if (intent === 'shop') requestShopOnBoard();
      navigate({ name: 'matchup', week, phase: 'setup' });
    } catch {
      setErr('Couldn’t load your board — check your connection and try again.');
      setBuilding(false);
    }
  };
  return { play, building, err };
}

const tile: React.CSSProperties = {
  width: '100%', textAlign: 'left', background: 'var(--surface)', border: '1px solid var(--bd)',
  borderRadius: 8, padding: '14px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12,
};
const tileTitle: React.CSSProperties = { fontSize: 14, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.01em' };
const tileSub: React.CSSProperties = { fontSize: 9.5, color: 'var(--dim)', lineHeight: 1.5, marginTop: 2 };
const linkBtn: React.CSSProperties = { background: 'none', border: 'none', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--dim)', cursor: 'pointer' };

function Tile({ icon, title, sub, badge, onClick, disabled, accent }: {
  icon: React.ReactNode; title: string; sub: string; badge?: React.ReactNode;
  onClick: () => void; disabled?: boolean; accent?: boolean;
}) {
  return (
    <button onClick={onClick} disabled={disabled}
      style={{ ...tile, ...(accent ? { borderLeft: '3px solid var(--you)' } : {}), opacity: disabled ? 0.55 : 1, cursor: disabled ? 'default' : 'pointer' }}>
      <span style={{ fontSize: 19, flexShrink: 0, width: 26, textAlign: 'center' }}>{icon}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span className="grotesk" style={{ ...tileTitle, display: 'flex', alignItems: 'center', gap: 8 }}>
          {title} {badge}
        </span>
        <span className="mono" style={{ ...tileSub, display: 'block' }}>{sub}</span>
      </span>
      <span className="mono" style={{ fontSize: 13, color: 'var(--faint)', flexShrink: 0 }}>→</span>
    </button>
  );
}

export function LeagueHubPage({ e, card, commish, userId, viewAsLabel, onBack, onResults, onTeam, onDraft, onManage }: {
  e: Enrollment;
  card?: { matchup: LiveMatchup; teams: Record<number, TeamInfo> };
  commish: boolean;
  userId: string;
  /** Browse-as (read-only) label — write doors refuse with this name. */
  viewAsLabel: string | null;
  onBack: () => void;
  onResults: () => void;
  onTeam: (focus?: 'trades' | 'waivers' | 'options') => void;
  onDraft: () => void;
  onManage: () => void;
}) {
  const { play, building, err: buildErr } = useHeroBoard(e, userId);
  const native = e.league?.provider === 'native';
  const [note, setNote] = useState<{ text: string; canEdit: boolean } | null>(null);
  const [unread, setUnread] = useState<{ n: number; mention: boolean }>({ n: 0, mention: false });
  const [chatOpen, setChatOpen] = useState(false);
  const [rostersOpen, setRostersOpen] = useState(false);

  useEffect(() => {
    // The note lives HERE now (0182.1 — off the board, founder's call), so the
    // commissioner's empty-state prompt shows too, not just a standing note.
    leagueNote(e.league_id)
      .then((r) => { if (r.ok && (r.text || r.can_edit)) setNote({ text: r.text ?? '', canEdit: !!r.can_edit }); })
      .catch(() => {});
    chatUnread(e.league_id)
      .then((r) => { if (r.ok) setUnread({ n: (r.league ?? 0) + (r.dm ?? 0), mention: (r.mention ?? 0) > 0 }); })
      .catch(() => {});
  }, [e.league_id]);

  const guard = (fn: () => void) => () => {
    if (viewAsLabel) { alert(`Read-only: you're browsing as ${viewAsLabel}. Exit view-as to use this.`); return; }
    fn();
  };

  const m = card?.matchup;
  const youAreHome = m ? m.home_roster_id === e.sleeper_roster_id : true;
  const oppRoster = m ? (youAreHome ? m.away_roster_id : m.home_roster_id) : null;
  const opp = m && oppRoster != null ? card?.teams[oppRoster] : null;
  const pending = !m;
  const live = m?.status === 'live';
  const matchupSub = m
    ? `${weekLabel(m.week)} · ${e.team_name} vs ${opp?.team_name ?? `Roster ${oppRoster}`}${live ? ' · LIVE' : ''}`
    : 'schedule pending — no opponent yet';

  return (
    <div style={{ maxWidth: 560, margin: '0 auto' }}>
      {/* identity header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
        <Img src={e.league?.avatar_url} size={44} radius={9} alt={e.league?.name ?? ''}
          fallback={<div className="grotesk" style={{ width: 44, height: 44, borderRadius: 9, background: 'var(--surface)', border: '1px solid var(--bd)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 17, fontWeight: 700, color: 'var(--you)' }}>{(e.league?.name ?? 'L').slice(0, 1).toUpperCase()}</div>} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="grotesk" style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.02em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.league?.name ?? 'League'}</div>
          <div className="mono" style={{ fontSize: 9.5, color: 'var(--faint)', marginTop: 2 }}>
            {e.league?.season ?? ''} · you are <b style={{ color: 'var(--text)' }}>{e.team_name}</b>{commish ? ' · ⚑ commissioner' : ''}
          </div>
        </div>
        <button onClick={onBack} className="mono" style={linkBtn}>← leagues</button>
      </div>

      {/* the commissioner's standing note — the board banner's message, here too */}
      {note && (
        <div className="mono" style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 11, lineHeight: 1.5, color: 'var(--text)', background: 'color-mix(in srgb, #A87BD8 10%, var(--surface))', border: '1px solid #A87BD8', borderRadius: 6, padding: '7px 11px', margin: '10px 0 0' }}>
          <span style={{ fontWeight: 700, letterSpacing: '0.1em', fontSize: 9, color: '#A87BD8', flex: 'none' }}>⚑ LEAGUE NOTE</span>
          {note.text
            ? <span style={{ minWidth: 0, flex: 1, whiteSpace: 'pre-wrap' }}>{note.text}</span>
            : <span style={{ minWidth: 0, flex: 1, color: 'var(--faint)' }}>nothing posted — say something to the league</span>}
          {note.canEdit && <button onClick={onManage} className="mono" style={{ ...linkBtn, flex: 'none', padding: 0 }}>✎ {note.text ? 'edit' : 'write'}</button>}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
        <Tile accent icon={<GameIcon name={BRAND_MARK} emoji="▶" size="1.2em" />}
          title={building ? 'Loading your board…' : live ? 'Go to your matchup' : 'My matchup'}
          sub={matchupSub}
          onClick={guard(() => void play())} disabled={building || pending} />
        {buildErr && <div className="mono" style={{ fontSize: 10, color: 'var(--opp)', lineHeight: 1.4 }}>{buildErr}</div>}

        <Tile icon="💬" title="Chat"
          badge={unread.n > 0
            ? <span className="mono" style={{ fontSize: 8.5, fontWeight: 700, color: 'var(--on-accent)', background: 'var(--you)', borderRadius: 999, padding: '2px 7px' }}>{unread.mention ? '@ ' : ''}{unread.n > 99 ? '99+' : unread.n}</span>
            : undefined}
          sub="league channel · direct messages"
          onClick={guard(() => { setChatOpen(true); setUnread({ n: 0, mention: false }); })} />

        <Tile icon="▦" title="All matchups & standings" sub="every pairing, every week, the table" onClick={onResults} />

        <Tile icon="◈" title="Power-up shop" sub="spend drip coin on this week's edge — opens on your board"
          onClick={guard(() => void play('shop'))} disabled={building || pending} />

        {native && (
          <>
            <Tile icon="⇄" title="Trades" sub="propose, review, and the league's trade block" onClick={guard(() => onTeam('trades'))} />
            <Tile icon="✚" title="Waivers & free agents" sub="claims, the wire, and who's unclaimed" onClick={guard(() => onTeam('waivers'))} />
            <Tile icon="👥" title="Teams & rosters" sub="every team in the league and who they're holding"
              onClick={() => setRostersOpen((v) => !v)} />
            {rostersOpen && <TeamsRosters leagueId={e.league_id} myRoster={e.sleeper_roster_id} />}
            <Tile icon="⚙" title="Team options" sub="rename your team · crest · league invite" onClick={guard(() => onTeam('options'))} />
            <Tile icon="⛏" title="Draft room" sub="the league's draft — live during draft night, the record after" onClick={guard(onDraft)} />
          </>
        )}

        {commish && (
          <Tile icon="⚑" title="Manage league" sub="members · commish kit · scoring · rules" onClick={onManage} accent />
        )}
      </div>

      {chatOpen && <ChatPanel leagueId={e.league_id} onClose={() => setChatOpen(false)} />}
    </div>
  );
}

// ── every team's roster, expanded in place ──────────────────────────────────
interface TeamGroup { rid: number; name: string; mine: boolean; players: { slug: string; name: string; pos: string; team: string }[]; }
const POS_ORDER: Record<string, number> = { QB: 0, RB: 1, WR: 2, TE: 3, K: 4, DEF: 5 };
const prettify = (slug: string) => slug.split('-').map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');

function TeamsRosters({ leagueId, myRoster }: { leagueId: string; myRoster: number }) {
  const [groups, setGroups] = useState<TeamGroup[] | null>(null);
  const [err, setErr] = useState(false);
  const [openRid, setOpenRid] = useState<number | null>(null);
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const [rows, pool] = await Promise.all([nativeRosters(leagueId), leaguePool(leagueId)]);
        const ids = [...new Set(rows.map((r) => r.roster_id))].sort((a, b) => a - b);
        const teams = await matchupTeams(leagueId, ids).catch(() => ({} as Record<number, TeamInfo>));
        const bySlug = new Map(pool.map((p) => [p.slug, p]));
        const g = ids.map((rid) => ({
          rid,
          name: teams[rid]?.team_name ?? `Roster ${rid}`,
          mine: rid === myRoster,
          players: rows.filter((r) => r.roster_id === rid).map((r) => {
            const p = bySlug.get(r.slug);
            return { slug: r.slug, name: p?.full_name ?? prettify(r.slug), pos: p?.pos ?? '', team: p?.team ?? '' };
          }).sort((a, b) => (POS_ORDER[a.pos] ?? 9) - (POS_ORDER[b.pos] ?? 9) || a.name.localeCompare(b.name)),
        }));
        if (!dead) setGroups(g);
      } catch { if (!dead) setErr(true); }
    })();
    return () => { dead = true; };
  }, [leagueId, myRoster]);
  if (err) return <div className="mono" style={{ fontSize: 10, color: 'var(--opp)' }}>Couldn’t load the rosters.</div>;
  if (groups == null) return <div className="mono" style={{ fontSize: 10, color: 'var(--faint)' }}>Loading rosters…</div>;
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 8, padding: '4px 14px' }}>
      {groups.map((g) => (
        <div key={g.rid} style={{ borderBottom: '1px solid var(--bd)' }}>
          <button onClick={() => setOpenRid(openRid === g.rid ? null : g.rid)}
            style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: '10px 0', cursor: 'pointer' }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: g.mine ? 'var(--you)' : 'var(--text)', flex: 1 }}>
              {g.name}{g.mine ? ' (you)' : ''}
            </span>
            <span className="mono" style={{ fontSize: 9, color: 'var(--faint)' }}>{g.players.length} players {openRid === g.rid ? '▾' : '▸'}</span>
          </button>
          {openRid === g.rid && (
            <div style={{ paddingBottom: 10 }}>
              {g.players.map((p) => (
                <div key={p.slug} style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '3px 0' }}>
                  <span className="mono" style={{ fontSize: 9, fontWeight: 700, color: 'var(--dim)', width: 28 }}>{p.pos}</span>
                  <span style={{ fontSize: 12, color: 'var(--text)', flex: 1 }}>{p.name}</span>
                  <span className="mono" style={{ fontSize: 9, color: 'var(--faint)' }}>{p.team}</span>
                </div>
              ))}
              {g.players.length === 0 && <div className="mono" style={{ fontSize: 10, color: 'var(--faint)' }}>Empty roster.</div>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
