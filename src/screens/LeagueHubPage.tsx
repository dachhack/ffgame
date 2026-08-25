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
import { Img, Sheet } from '../app/ui';
import { useWide } from './adminUi';
import { NotifPrefsCard } from './NativeLeague';
import {
  myMatchup, defaultOpenWeek, matchupTeams, leagueNote, leagueSignals, nativeRosters, leaguePool, playoffState, leagueGameMode, leagueContracts, chatMembers,
  leaveLeague, friendlyError,
  type Enrollment, type LiveMatchup, type TeamInfo,
} from '@drip/core/data/liveApi';
import { buildLiveLeague } from '@drip/core/data/liveBoard';
import { PRESEASON_BASE } from '@drip/core/data/nflSlate';
import { setCardLeague } from '../app/playerCard';
import { ScoringPanel, RosterRulesPanel, RegisterPanel, RecruitPanel } from './LeagueInfo';

/** A titled band of tiles — the app's league menu splits at "THE LEAGUE" and
 *  this is that heading (v0.287.0). Without it the hub reads as one
 *  undifferentiated pile: your week and the league's own reference sheets look
 *  alike when they are stacked in one column with no seam. */
function Band({ title, wide, children }: { title?: string; wide: boolean; children: React.ReactNode }) {
  return (
    <section style={{ marginTop: 14 }}>
      {/* TITLELESS above THE LEAGUE (v0.296.2): the app's menu has one heading,
          not two — the shop simply sits at the top, and a "YOUR WEEK" band over
          a single tile was a label longer than the thing it labelled. */}
      {!!title && <div className="mono" style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.14em', color: 'var(--faint)', marginBottom: 6 }}>{title}</div>}
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

/** NO ICONS (v0.293.1, founder: "get rid of icons on the league home"). A stack
 *  of emoji — a scroll, a cap, a bell, a megaphone — were as many art styles as
 *  there were tiles, doing the job the TITLE was already doing. `icon` is kept
 *  and ignored rather than threaded out of every call site: it costs nothing,
 *  and it is where an icon would go back if the answer turns out to be "a
 *  consistent SET", not "none". Matches the app's league menu. */
function Tile({ icon: _icon, title, sub, badge, onClick, disabled, accent }: {
  icon: React.ReactNode; title: string; sub: string; badge?: React.ReactNode;
  onClick: () => void; disabled?: boolean; accent?: boolean;
}) {
  return (
    <button onClick={() => { track(Ev.hubTileOpened, { tile: title.toLowerCase() }); onClick(); }} disabled={disabled}
      style={{ ...tile, ...(accent ? { borderLeft: '3px solid var(--you)' } : {}), opacity: disabled ? 0.55 : 1, cursor: disabled ? 'default' : 'pointer' }}>
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

export function LeagueHubPage({ e, card, commish, userId, viewAsLabel, onBack, onResults, onDraft, onManage }: {
  e: Enrollment;
  /** This week's matchup, when the schedule has one. All that is read from it
   *  now is WHETHER it exists — the shop opens on a board, and a league with no
   *  matchup yet has none to open. */
  card?: { matchup: LiveMatchup; teams: Record<number, TeamInfo> };
  commish: boolean;
  userId: string;
  /** Browse-as (read-only) label — write doors refuse with this name. */
  viewAsLabel: string | null;
  onBack: () => void;
  onResults: () => void;
  onDraft: () => void;
  onManage: () => void;
}) {
  const { play, building, err: buildErr } = useHeroBoard(e, userId);
  const native = e.league?.provider === 'native';
  const [note, setNote] = useState<{ text: string; canEdit: boolean } | null>(null);
  // `polls_unvoted` moved to the strip's 💬 dot with the chat tile (v0.288.0),
  // and the waiver count left with the MY TEAM tiles (v0.296.2) — a badge for a
  // room this menu no longer opens is a badge you cannot act on. The
  // commissioner's queue is what is left to badge.
  const [sig, setSig] = useState<{ commish: { waiting: number; review: number } | null }>({ commish: null });
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
  // Leaving (0188) — armed on the first click, done on the second.
  const [leaveArmed, setLeaveArmed] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [leaveErr, setLeaveErr] = useState<string | null>(null);
  const doLeave = async () => {
    if (leaving) return;
    if (!leaveArmed) { setLeaveArmed(true); return; }
    setLeaving(true); setLeaveErr(null);
    try {
      const r = await leaveLeague(e.league_id);
      if (!r.ok) { setLeaveErr(friendlyError(r.error ?? 'that didn’t work')); setLeaveArmed(false); return; }
      // Out to the leagues list — the page behind this one is a league this
      // account is no longer in.
      onBack();
    } catch (x) { setLeaveErr(friendlyError(x)); setLeaveArmed(false); }
    finally { setLeaving(false); }
  };
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
      .then((r) => { if (r.ok) setSig({ commish: r.commish ?? null }); })
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

  // The schedule hasn't dealt this seat a game yet — the shop has no board to
  // open on, so its tile greys out. The rest of what was derived from the
  // matchup went with the THIS WEEK line (v0.296.2).
  const pending = !card?.matchup;

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
            {e.league?.season ?? ''} · you are <b style={{ color: 'var(--text)' }}>{e.team_name}</b>{commish ? ' · commissioner' : ''}
          </div>
        </div>
      </div>

      {/* the commissioner's standing note — the board banner's message, here too */}
      {note && (
        <div className="mono" style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 11, lineHeight: 1.5, color: 'var(--text)', background: 'color-mix(in srgb, #A87BD8 10%, var(--surface))', border: '1px solid #A87BD8', borderRadius: 6, padding: '7px 11px', margin: '10px 0 0' }}>
          <span style={{ fontWeight: 700, letterSpacing: '0.1em', fontSize: 9, color: '#A87BD8', flex: 'none' }}>LEAGUE NOTE</span>
          {note.text
            ? <span style={{ minWidth: 0, flex: 1, whiteSpace: 'pre-wrap' }}>{note.text}</span>
            : <span style={{ minWidth: 0, flex: 1, color: 'var(--faint)' }}>nothing posted — say something to the league</span>}
          {note.canEdit && <button onClick={onManage} className="mono" style={{ ...linkBtn, flex: 'none', padding: 0 }}>✎ {note.text ? 'edit' : 'write'}</button>}
        </div>
      )}

      {/* ── THE MENU IS THE APP'S MENU (v0.287.0, matched item-for-item in
          v0.296.2) ─────────────────────────────────────────────────────────
          Founder: "I like the league and commish menu layout on the app —
          mirror that in the mobile web and create a big version for desktop",
          then: "using the app as the standard, let's match the mobile web
          league page menu and selection locations to the app."

          So the app is the standard and this is its menu: the shop, unlabelled
          and alone, then THE LEAGUE and the league's own rooms and reference
          sheets in the app's order. What used to differ was everything ABOVE
          the heading — a THIS WEEK line, a YOUR WEEK band, and tiles for
          trades / waivers / team options — all of it either a chip on the strip
          above this page or a section of the page that chip opens.

          The one deliberate divergence left is 🏆 STANDINGS, which on the web
          opens the full results page: the app's sheet holds a table and a
          bracket, and the web's page holds those plus every pairing of every
          week. Same place in the menu, more behind it. */}
      {/* THE SHOP, ALONE AND UNLABELLED — the app's arrangement exactly
          (v0.296.2). Trades, waivers and team options used to sit beside it
          under a YOUR WEEK heading; every one of them is a SECTION OF THE TEAM
          PAGE, which is a chip on the strip above this menu, so the tiles were
          scroll shortcuts wearing the clothes of destinations. The app dropped
          them for that reason ("a menu that repeats the strip is a menu you
          have to read twice") and keeps only the shop, which has no chip
          anywhere and spends coin that is yours rather than the league's. */}
      {!classic && (
        <Band wide={wide}>
          <Tile icon="◈" title="Power-up shop" sub="spend drip coin — opens on your board"
            onClick={guard(() => void play('shop'))} disabled={building || pending} />
        </Band>
      )}
      {buildErr && <div className="mono" style={{ fontSize: 10, color: 'var(--opp)', lineHeight: 1.4, marginTop: 8 }}>{buildErr}</div>}

      {/* SELECTIONS ARRIVE AS POPUPS (v0.296.3, founder: "stick with the pop
          up for all the items where we have that in the app"). These panels
          used to EXPAND — first below the whole menu, then under their own tile
          — and both readings put the menu in motion under your finger and left
          the web answering a tap differently than the app does. Every one of
          these is an Overlay on the app, so every one of them is a Sheet here:
          over the page, one dismiss from gone, the menu untouched behind it. */}
      <Band wide={wide}>
        {native && (
          <Tile icon="👥" title="Teams & rosters" sub="every team in the league and who they're holding"
            onClick={() => setRostersOpen((v) => !v)} />
        )}
        {native && <Tile icon="⛏" title="Draft room" sub="live on draft night, the record after" onClick={guard(onDraft)} />}

        {/* The app's wording, plus the half the app's sheet cannot hold: the
            web opens the full results page, which is the table AND every
            pairing of every week. */}
        <Tile icon="🏆" title="Standings" sub="the table · playoff bracket · every pairing, every week" onClick={onResults} />

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

      {/* The sheets — one at a time, the app's rule, with the app's titles and
          subtitles so the same room is announced the same way on both. */}
      {rostersOpen && native && (
        <Sheet title="👥 Teams & rosters" subtitle="TAP A TEAM TO SEE WHO THEY'RE HOLDING" max={620} onClose={() => setRostersOpen(false)}>
          <TeamsRosters leagueId={e.league_id} myRoster={e.sleeper_roster_id} />
        </Sheet>
      )}
      {info === 'register' && (
        <Sheet title="📜 League register" subtitle="EVERY MOVE SINCE THE DRAFT · NEWEST FIRST" max={760} onClose={() => setInfo(null)}>
          <RegisterPanel leagueId={e.league_id} bare />
        </Sheet>
      )}
      {info === 'scoring' && (
        <Sheet title="⊞ Scoring settings" subtitle="HOW THIS LEAGUE TURNS PLAYS INTO POINTS" max={760} onClose={() => setInfo(null)}>
          <ScoringPanel leagueId={e.league_id} bare />
        </Sheet>
      )}
      {info === 'roster' && (
        <Sheet title="🧢 Roster settings" subtitle="LINEUP SPOTS · LIMITS · WAIVERS · TRADES" max={760} onClose={() => setInfo(null)}>
          <RosterRulesPanel leagueId={e.league_id} bare />
        </Sheet>
      )}
      {info === 'alerts' && (
        <Sheet title="🔔 Alerts" subtitle="WHAT PINGS THIS BROWSER" onClose={() => setInfo(null)}>
          <NotifPrefsCard bare />
        </Sheet>
      )}
      {info === 'recruit' && (
        <Sheet title="📣 Recruit" subtitle={commish ? 'SEND A LINK · POST TO THE BOARD' : 'SEND A LINK TO A FRIEND'} onClose={() => setInfo(null)}>
          <RecruitPanel leagueId={e.league_id} commish={commish} bare />
        </Sheet>
      )}

      {/* ── THE WAY OUT (0188) ──────────────────────────────────────────────
          Quiet, last, and below the bands — a door you should be able to find
          without being offered it. Two clicks, because leaving is not undoable
          by you: the seat opens and the next manager inherits your team.

          The COMMISSIONER doesn't get it. `leave_league` refuses them — they
          would orphan the league, since every commish RPC is
          `commissioner_id = auth.uid()` — so offering the button and then
          explaining the refusal would be worse than not offering it. Their way
          out is ⚑ Manage league → DANGER. */}
      {!commish && (
        <div style={{ marginTop: 26, paddingTop: 14, borderTop: '1px solid var(--bd)', textAlign: 'center' }}>
          {leaveErr && <div className="mono" style={{ fontSize: 9.5, color: 'var(--opp)', lineHeight: 1.5, marginBottom: 8 }}>{leaveErr}</div>}
          <button onClick={doLeave} disabled={leaving} className="mono"
            style={{ background: 'none', border: 'none', padding: '8px 14px', fontSize: 9.5, fontWeight: 700, letterSpacing: '0.06em',
              color: leaveArmed ? 'var(--opp)' : 'var(--faint)', cursor: leaving ? 'default' : 'pointer' }}>
            {leaving ? 'LEAVING…' : leaveArmed ? '✕ CLICK AGAIN TO LEAVE THIS LEAGUE' : 'leave this league'}
          </button>
          {leaveArmed && !leaving && (
            <div className="mono" style={{ fontSize: 8.5, color: 'var(--faint)', marginTop: 2, lineHeight: 1.5 }}>
              Your seat opens for someone else. Your team name and roster stay with it.
            </div>
          )}
        </div>
      )}

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
  // A contract league's roster IS its payroll (v0.355.9, founder: "teams and
  // rosters page ... should see the contracts"): every player carries his
  // deal, every team header its total. Both maps stay empty without contracts.
  const [deals, setDeals] = useState<Map<string, string>>(new Map());
  const [pay, setPay] = useState<Map<number, string>>(new Map());
  // Who OWNS each seat (0238) — the member's name under the team's.
  const [owners, setOwners] = useState<Map<number, string>>(new Map());
  useEffect(() => {
    let dead = false;
    chatMembers(leagueId).then((r) => {
      if (dead || !r.ok) return;
      const byId = new Map((r.members ?? []).map((m) => [m.id, m.name]));
      setOwners(new Map((r.seats ?? []).flatMap((st) => {
        const n = byId.get(st.user);
        return n ? [[st.roster, n] as const] : [];
      })));
    }).catch(() => {});
    leagueContracts(leagueId).then((c) => {
      if (dead || !c.contracts) return;
      setDeals(new Map((c.deals ?? []).map((d) => [d.slug, `$${d.salary}·${d.years}yr${d.tagged ? ' ⭐' : ''}`])));
      setPay(new Map((c.payrolls ?? []).map((p) => [p.roster_id, `$${p.payroll}${p.cap != null ? ` of $${p.cap}` : ''}`])));
    }).catch(() => {});
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
  // No card of its own: this only ever renders inside a Sheet now (v0.296.3),
  // which is the card.
  return (
    <div>
      {groups.map((g) => (
        <div key={g.rid} style={{ borderBottom: '1px solid var(--bd)' }}>
          <button onClick={() => setOpenRid(openRid === g.rid ? null : g.rid)}
            style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: '10px 0', cursor: 'pointer' }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: g.mine ? 'var(--you)' : 'var(--text)', flex: 1, minWidth: 0 }}>
              {g.name}{g.mine ? ' (you)' : ''}
              {owners.get(g.rid) && <span className="mono" style={{ fontSize: 9, fontWeight: 400, color: 'var(--faint)' }}> · {owners.get(g.rid)}</span>}
            </span>
            <span className="mono" style={{ fontSize: 9, color: 'var(--faint)' }}>{pay.get(g.rid) ? `${pay.get(g.rid)} · ` : ''}{g.players.length} players {openRid === g.rid ? '▾' : '▸'}</span>
          </button>
          {openRid === g.rid && (
            <div style={{ paddingBottom: 10 }}>
              {g.players.map((p) => (
                <div key={p.slug} style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '3px 0' }}>
                  <span className="mono" style={{ fontSize: 9, fontWeight: 700, color: 'var(--dim)', width: 28 }}>{p.pos}</span>
                  <span style={{ fontSize: 12, color: 'var(--text)', flex: 1 }}>{p.name}</span>
                  {deals.get(p.slug) != null && <span className="mono" style={{ fontSize: 9, fontWeight: 700, color: 'var(--dim)', whiteSpace: 'nowrap' }}>{deals.get(p.slug)}</span>}
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
