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
import { Ev, track } from '@drip/core/analytics';
import { useEffect, useState } from 'react';
import { useStore } from '../app/store';
import { Img } from '../app/ui';
import { useWide } from './adminUi';
import { NotifPrefsCard } from './NativeLeague';
import {
  myMatchup, defaultOpenWeek, matchupTeams, leagueNote, leagueSignals, nativeRosters, leaguePool, playoffState, leagueGameMode,
  type Enrollment, type LiveMatchup, type TeamInfo,
} from '@drip/core/data/liveApi';
import { buildLiveLeague } from '@drip/core/data/liveBoard';
import { PRESEASON_BASE, weekLabel } from '@drip/core/data/nflSlate';
import { setCardLeague } from '../app/playerCard';
import { ScoringPanel, RosterRulesPanel, RegisterPanel, RecruitPanel } from './LeagueInfo';

/** A titled band of tiles — the app's league menu splits at "THE LEAGUE" and
 *  this is that heading (v0.287.0). Without it the hub reads as one
 *  undifferentiated pile: your week and the league's own reference sheets look
 *  alike when they are stacked in one column with no seam. */
function Band({ title, wide, children }: { title: string; wide: boolean; children: React.ReactNode }) {
  return (
    <section style={{ marginTop: 14 }}>
      <div className="mono" style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.14em', color: 'var(--faint)', marginBottom: 6 }}>{title}</div>
      {/* TWO COLUMNS ON DESKTOP, one on a phone. The tiles are a fixed-height
          row of icon + title + sub, so they tile cleanly; below 900px a second
          column would squeeze the subtitles into two lines each. */}
      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: wide ? 'repeat(2, minmax(0, 1fr))' : '1fr' }}>
        {children}
      </div>
    </section>
  );
}

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
export function useHeroBoard(e: Enrollment | null, userId: string) {
  const { loadSimLeague, navigate } = useStore();
  const [building, setBuilding] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const play = async (intent?: 'shop') => {
    // NULLABLE `e` since v0.288.0: LiveOnboard calls this unconditionally at the
    // top of its body so the league strip's ▦ MATCHUP chip can build the board
    // from any room, and a hook cannot be called only when a league is open.
    if (!e || building) return;
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
    <button onClick={() => { track(Ev.hubTileOpened, { tile: title.toLowerCase() }); onClick(); }} disabled={disabled}
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
  // `polls_unvoted` moved to the strip's 💬 dot with the chat tile (v0.288.0);
  // what is left here is what the hub's own tiles badge.
  const [sig, setSig] = useState<{ waivers: number; commish: { waiting: number; review: number } | null }>({ waivers: 0, commish: null });
  const [rostersOpen, setRostersOpen] = useState(false);
  // The league's reference panels (v0.274.0, founder's menu list). One piece
  // of state — only ever one is open, and they expand in place like the
  // rosters tile above rather than stealing the page.
  // One panel at a time, `null` being the menu itself — the app's rule, and the
  // reason a second click on the open tile closes it. 'alerts' joined in
  // v0.287.0: the app puts push prefs on the league menu, so the web's mirror
  // hosts the same NotifPrefsCard the team screen does rather than a fork.
  type InfoPanel = 'scoring' | 'roster' | 'register' | 'alerts' | 'recruit';
  const [info, setInfo] = useState<null | InfoPanel>(null);
  const toggleInfo = (k: InfoPanel) => setInfo((cur) => (cur === k ? null : k));
  const [champion, setChampion] = useState<string | null>(null);
  // Classic leagues (0157) have no power-ups, so no shop tile (v0.273.0,
  // founder). Defaults false — drip is the common case, and a tile popping in
  // would be worse than one briefly showing.
  const [classic, setClassic] = useState(false);

  // Cards opened from this page (TeamsRosters) get the league's own
  // panels — who owns him, and what the league did with him (v0.282.0).
  useEffect(() => { setCardLeague(e.league_id); return () => setCardLeague(null); }, [e.league_id]);

  useEffect(() => {
    leagueGameMode(e.league_id)
      .then((gm) => { if (gm.ok && gm.mode === 'classic') setClassic(true); })
      .catch(() => {});
    // The note lives HERE now (0182.1 — off the board, founder's call), so the
    // commissioner's empty-state prompt shows too, not just a standing note.
    leagueNote(e.league_id)
      .then((r) => { if (r.ok && (r.text || r.can_edit)) setNote({ text: r.text ?? '', canEdit: !!r.can_edit }); })
      .catch(() => {});
    leagueSignals(e.league_id)
      .then((r) => { if (r.ok) setSig({ waivers: r.waiver_results ?? 0, commish: r.commish ?? null }); })
      .catch(() => {});
    // Season's over and someone won it? The hub wears the banner (0199).
    playoffState(e.league_id)
      .then((st) => { if (st.champion_team) setChampion(st.champion_team); })
      .catch(() => {});
  }, [e.league_id]);

  const guard = (fn: () => void) => () => {
    if (viewAsLabel) { alert(`Read-only: you're browsing as ${viewAsLabel}. Exit view-as to use this.`); return; }
    fn();
  };

  // Desktop gets the BIG version of the same menu (v0.287.0): two columns of
  // tiles in a 1080px page, rather than the 440px phone column the hub was
  // getting on every screen size.
  const wide = useWide(900);

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
    <div style={{ maxWidth: wide ? 1080 : 560, margin: '0 auto' }}>
      {/* champion banner — the season is decided; the hub says so first */}
      {champion && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'color-mix(in srgb, #D8B24A 14%, var(--surface))', border: '1px solid #D8B24A', borderRadius: 8, padding: '12px 16px', marginBottom: 12 }}>
          <span style={{ fontSize: 24, flexShrink: 0 }}>🏆</span>
          <div style={{ minWidth: 0 }}>
            <div className="grotesk" style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.01em' }}>{champion}</div>
            <div className="mono" style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', color: '#D8B24A', marginTop: 2 }}>LEAGUE CHAMPIONS — THE SEASON IS IN THE BOOKS</div>
          </div>
        </div>
      )}
      {/* identity header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
        <Img src={e.league?.avatar_url} size={44} radius={9} alt={e.league?.name ?? ''}
          fallback={<div className="grotesk" style={{ width: 44, height: 44, borderRadius: 9, background: 'var(--surface)', border: '1px solid var(--bd)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 17, fontWeight: 700, color: 'var(--you)' }}>{(e.league?.name ?? 'L').slice(0, 1).toUpperCase()}</div>} />
        {/* NO SECOND TITLE (v0.288.0) — the league strip one row up is the
            name now, at the same size, and printing it again here just pushed
            the menu down. The app made this exact trim in v0.280.0. What is
            left is the line the strip does NOT carry: which seat you are. */}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="mono" style={{ fontSize: 9.5, color: 'var(--faint)' }}>
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

      {/* ── THE MENU, IN THE APP'S TWO BANDS (v0.287.0) ───────────────────
          Founder: "I like the league and commish menu layout on the app —
          mirror that in the mobile web and create a big version for desktop."

          The app splits at THE LEAGUE: above it is YOUR WEEK (your board, your
          team, the chat), below it the league itself — who is in it, what it
          did, the rules it runs on. This hub had the same tiles in the same
          idiom but in one unbroken column, so the seam the app reads by was
          missing.

          WHAT STAYS DIFFERENT, deliberately: the app drops MATCHUP / MY TEAM /
          CHAT from its menu because they are chips on the strip above it. The
          web has no strip — this hub IS the navigation — so they stay tiles
          here. Same layout, different amount of work for it to do.

          An OPEN PANEL breaks out of the grid to full width below its band: a
          register or a scoring table crammed into one half-width grid cell
          would be a worse read than the tile it came from. */}
      {/* WHO YOU PLAY THIS WEEK — the one thing the matchup TILE carried that
          the strip's ▦ MATCHUP chip cannot: the week, the opponent, and whether
          it is live. The tile itself is gone (v0.288.0, the founder's v0.275.0
          rule now that the web has a strip: a menu that repeats the strip is a
          menu you read twice), so the line it was a subtitle to stays on its
          own — and still opens the board, since a live matchup should be one
          click from the hub however the chips are arranged. */}
      {!pending && (
        <button onClick={guard(() => void play())} disabled={building} className="mono"
          style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', marginTop: 12,
            background: live ? 'color-mix(in srgb, var(--you) 10%, var(--surface))' : 'var(--surface)',
            border: `1px solid ${live ? 'var(--you)' : 'var(--bd)'}`, borderRadius: 8, padding: '9px 13px',
            fontSize: 10.5, color: 'var(--text)', cursor: building ? 'default' : 'pointer', opacity: building ? 0.6 : 1 }}>
          <span style={{ fontWeight: 700, letterSpacing: '0.1em', fontSize: 8.5, color: live ? 'var(--you)' : 'var(--faint)', flex: 'none' }}>
            {building ? 'LOADING…' : live ? '● LIVE' : 'THIS WEEK'}
          </span>
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{matchupSub}</span>
          <span style={{ color: 'var(--faint)', flex: 'none' }}>→</span>
        </button>
      )}

      <Band title="YOUR WEEK" wide={wide}>
        {!classic && (
          <Tile icon="◈" title="Power-up shop" sub="spend drip coin on this week's edge — opens on your board"
            onClick={guard(() => void play('shop'))} disabled={building || pending} />
        )}

        {native && (
          <>
            <Tile icon="⇄" title="Trades" sub="propose, review, and the league's trade block" onClick={guard(() => onTeam('trades'))} />
            <Tile icon="✚" title="Waivers & free agents" sub="claims, the wire, and who's unclaimed" onClick={guard(() => onTeam('waivers'))}
              badge={sig.waivers > 0 ? <span className="mono" style={{ fontSize: 8.5, fontWeight: 700, color: 'var(--you)', border: '1px solid var(--you)', borderRadius: 999, padding: '2px 7px' }}>✚ {sig.waivers} resolved</span> : undefined} />
            <Tile icon="⚙" title="Team options" sub="rename your team · crest · league invite" onClick={guard(() => onTeam('options'))} />
          </>
        )}
      </Band>
      {buildErr && <div className="mono" style={{ fontSize: 10, color: 'var(--opp)', lineHeight: 1.4, marginTop: 8 }}>{buildErr}</div>}

      <Band title="THE LEAGUE" wide={wide}>
        {native && (
          <Tile icon="👥" title="Teams & rosters" sub="every team in the league and who they're holding"
            onClick={() => setRostersOpen((v) => !v)} />
        )}
        {native && <Tile icon="⛏" title="Draft room" sub="live on draft night, the record after" onClick={guard(onDraft)} />}
        <Tile icon="🏆" title="Standings & all matchups" sub="the table · every pairing, every week" onClick={onResults} />
        {/* The league's own reference sheets (v0.274.0) — what it did, and the
            rules it runs on. Read-only for everyone; the commissioner edits the
            same facts behind ⚑ Manage league. */}
        {native && <Tile icon="📜" title="League register" sub="every add, drop, claim and trade" onClick={() => toggleInfo('register')} />}
        <Tile icon="⊞" title="Scoring settings" sub="how this league turns plays into points" onClick={() => toggleInfo('scoring')} />
        {native && <Tile icon="🧢" title="Roster settings" sub="lineup spots · limits · waivers · trades" onClick={() => toggleInfo('roster')} />}
        <Tile icon="🔔" title="Alerts" sub="push notifications — what pings this browser" onClick={() => toggleInfo('alerts')} />
        {/* 📣 RECRUIT (v0.291.0) — every member gets the tile, because the LINK
            half is every member's; the board half inside it is commish-gated
            and simply isn't drawn for anyone else. */}
        <Tile icon="📣" title="Recruit" sub={commish ? 'send an invite link · post to the board' : 'send an invite link to a friend'}
          onClick={() => toggleInfo('recruit')} />

        {commish && (
          <Tile icon="⚑" title="Commissioner" sub="seats · rules · kit · scoring" onClick={onManage} accent
            badge={sig.commish && sig.commish.waiting + sig.commish.review > 0
              ? <span className="mono" style={{ fontSize: 8.5, fontWeight: 700, color: 'var(--on-accent)', background: 'var(--warn)', borderRadius: 999, padding: '2px 7px' }}>{sig.commish.waiting + sig.commish.review} waiting</span>
              : undefined} />
        )}
      </Band>

      {/* The panels, full width under the bands — one at a time, same as the
          app's one-sheet-at-a-time rule. */}
      <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {rostersOpen && native && <TeamsRosters leagueId={e.league_id} myRoster={e.sleeper_roster_id} />}
        {info === 'register' && <RegisterPanel leagueId={e.league_id} />}
        {info === 'scoring' && <ScoringPanel leagueId={e.league_id} />}
        {info === 'roster' && <RosterRulesPanel leagueId={e.league_id} />}
        {info === 'alerts' && <NotifPrefsCard />}
        {info === 'recruit' && <RecruitPanel leagueId={e.league_id} commish={commish} />}
      </div>

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
