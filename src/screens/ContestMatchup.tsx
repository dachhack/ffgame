// THE MATCHUP, AS CARDS (v0.677.0). Founder: "incorporate the card theme into
// the weekly contest leagues. So on the matchup screen your cards down one
// column with your opponent's card backs down the other side, then they flip
// at kickoff. Each time you go back to the matchup screen it does the flip
// over animation again for cards that have had their kick off."
//
// The card-table kit (src/app/cardTable.tsx) is the drip board's; this is
// the same deck on a contest week. Your squad is face up from the start (it
// is yours to see); the other squad is a column of card backs, each turning
// face up as its player's game kicks off — contest_matchup (0479) seals a
// player until then, so the back is all the browser ever has. A face-up
// opponent card enters with the kit's reveal flip, and this screen mounts
// afresh on every visit, so the flip plays again each time. The picker above
// the table walks the week's other matchups (every seat's squad on a
// leaderboard); the week arrows live in the league frame.
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { contestMatchup, contestState, contestArmPlay, contestDisarmPlay, podSalaries, weekGameLocks, weekSlateByTeam, friendlyError, type ContestMatchupState, type ContestState, type ContestPlayRow, type PodSalaryRow, type SlateSpot } from '@drip/core/data/liveApi';
import { contestSlotLabels, contestCard, contestTiebreak, contestScoreWord, contestPlayById, contestRedeal, contestPlaysFor, contestPlayCap, contestSpotOpen, contestHandCard, type ContestPlayId } from '@drip/core/engine/contest';
import { GHOST_PLAYER } from '@drip/core/engine/sim';
import { GHOST_CARD } from '@drip/core/data/ghostCard';
import { ringScore } from '@drip/core/engine/bullseye';
import { leagueWeekProj } from '@drip/core/engine/contestBuilder';
import { classicSlotsFromSpec, type ClassicScoring } from '@drip/core/engine/classic';
import { leagueCatalogOf } from '@drip/core/engine/projScoring';
import { CardTableCss, Felt, PlayerCard, SealedCard, PowerupHand, type HandCard } from '../app/cardTable';
import { InfoChip } from './adminUi';

const card: CSSProperties = { background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 10, padding: 14 };
const small: CSSProperties = { fontSize: 10, color: 'var(--faint)' };
const chip = (on: boolean): CSSProperties => ({
  fontFamily: 'inherit', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.04em', cursor: 'pointer',
  color: on ? 'var(--on-accent, var(--bg))' : 'var(--you)', background: on ? 'var(--you)' : 'transparent',
  border: `1px solid ${on ? 'var(--you)' : 'color-mix(in srgb, var(--you) 45%, var(--bd))'}`, borderRadius: 999, padding: '5px 12px',
});

type Row = { slot: string; slug: string | null; sealed: boolean };
/** A squad's rows per spot: the saved player, a sealed marker, or nothing. */
export function squadRows(entry: unknown, slots: { slot: string }[]): Row[] {
  const list = Array.isArray(entry) ? entry as { slot?: unknown; player_slug?: unknown; sealed?: unknown }[] : [];
  const by = new Map<string, Row>();
  for (const r of list) if (typeof r?.slot === 'string') by.set(r.slot, { slot: r.slot, slug: typeof r.player_slug === 'string' ? r.player_slug : null, sealed: r.sealed === true });
  return slots.map((d) => by.get(d.slot) ?? { slot: d.slot, slug: null, sealed: false });
}

/** THE TIE-BREAKER CHIP (v0.682.2): what the number on the card means. */
const TB_NOTE = 'This spot is your tie-breaker: its player aims at this number. If the matchup ties on rings, the squad whose tie-breaker lands closer to its own number wins.';

export function ContestMatchup({ leagueId, week }: { leagueId: string; week: number }) {
  const [st, setSt] = useState<ContestMatchupState | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [tbNote, setTbNote] = useState<string | null>(null);   // THE TIE-BREAKER CHIP (v0.682.2): the explainer, on a click
  const [board, setBoard] = useState<PodSalaryRow[]>([]);
  const read = useCallback(() => contestMatchup(leagueId, week, pick).then(setSt).catch(() => {}), [leagueId, week, pick]);
  useEffect(() => {
    void read();
    const id = setInterval(() => void read(), 60_000);
    return () => clearInterval(id);
  }, [read]);
  // THE HAND ON THE MATCHUP (v0.695.0, founder: "put the card hand and power up application on the matchup"):
  // my seat's hand, plays and cap ride contest_state; a play lands on a spot by a tap on its card here.
  // Only a spot whose player hasn't kicked off lights up ("Only Josh Allen and DJ Moore should be able to
  // be targeted by double or nothing"); the rest dim. The shop stays on MY TEAM.
  const [ps, setPs] = useState<ContestState | null>(null);
  const [plays, setPlays] = useState<ContestPlayRow[]>([]);
  const [inventory, setInventory] = useState<Record<string, number>>({});
  const [arming, setArming] = useState<ContestPlayId | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [locks, setLocks] = useState<Map<string, number>>(new Map());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(id); }, []);
  const me = st?.ok ? st.me ?? null : null;
  useEffect(() => {
    if (me == null) { setPs(null); return; }
    let alive = true;
    contestState(leagueId, week, '2026', me).then((r) => { if (!alive) return; setPs(r); setPlays(r.plays ?? []); setInventory(r.inventory ?? {}); }).catch(() => {});
    weekGameLocks(week, '2026', 0).then((lk) => { if (alive) setLocks(lk); }).catch(() => {});
    return () => { alive = false; };
  }, [leagueId, week, me]);
  const [slate, setSlate] = useState<Map<string, SlateSpot>>(new Map());
  useEffect(() => { podSalaries(week).then(setBoard).catch(() => setBoard([])); weekSlateByTeam(week).then(setSlate).catch(() => {}); }, [week]);
  const bySlug = useMemo(() => new Map(board.map((r) => [r.slug, r])), [board]);
  const slots = useMemo(() => classicSlotsFromSpec(st?.slots ?? null) ?? [], [st?.slots]);
  const labels = useMemo(() => contestSlotLabels(slots), [slots]);
  // PROJECTIONS (v0.678.0): priced by the league's own scoring, as the builder prices them.
  const catalog = useMemo(() => leagueCatalogOf({ scoring: (st?.scoring_classic ?? null) as Partial<ClassicScoring> | null, ppr: st?.ppr ?? null }), [st?.scoring_classic, st?.ppr]);
  const projOf = (slug: string): number | null => { const r = bySlug.get(slug); return r ? leagueWeekProj(r, catalog, r.pos === 'HC' ? (slate.size ? slate.get(r.team) ?? null : undefined) : undefined) : null; };
  const bull = st?.contest === 'bullseye';
  const theCard = useMemo(() => (st?.contest === 'bullseye' && st.week != null && slots.length ? contestCard(leagueId, st.week, slots, catalog) : null), [leagueId, st?.contest, st?.week, slots, catalog]);
  const isTotal = bull && st?.variant === 'total';
  const locked = (slug: string | null) => { if (!slug) return false; const tm = locks.get(bySlug.get(slug)?.team ?? ''); return tm != null && tm <= now; };
  if (!st) return <div className="mono" style={{ padding: 24, ...small }}>Loading…</div>;
  if (!st.ok) return <div style={{ padding: 24 }}><div className="mono" style={{ color: 'var(--warn, #c66)', fontSize: 12 }}>{st.error}</div></div>;
  const m = st.matchup;
  const word = contestScoreWord(st.contest ?? 'high', st.variant);
  if (!m) {
    return <div style={{ ...card }}><span className="mono" style={small}>{`No matchup for week ${st.week ?? week} yet — squads are paired once the week's board is up.`}</span></div>;
  }
  // Your side goes left. A matchup you're not in reads home then away.
  const mineHome = st.me != null && m.home === st.me;
  const mineAway = st.me != null && m.away === st.me && m.away !== m.home;
  const left = mineAway ? 'away' : 'home';
  const right = left === 'home' ? 'away' : 'home';
  const solo = m.away === m.home;
  const side = (s: 'home' | 'away') => ({
    team: s === 'home' ? m.home_team : m.away_team,
    rows: squadRows(s === 'home' ? m.home_entry : m.away_entry, slots),
    score: m.status === 'final' ? (s === 'home' ? m.home_final : m.away_final) : st.started && m.state ? (s === 'home' ? m.state.home : m.state.away) : null,
    mine: (s === 'home' && mineHome) || (s === 'away' && mineAway),
  });
  const L = side(left), R = side(right);
  // my table: the hand plays here; another matchup is only watched
  const myTable = L.mine && ps?.ok === true && ps.coin === true && m.status !== 'final';
  type PlayResult = { ok: boolean; error?: string; plays?: ContestPlayRow[]; wallet?: number | null; inventory?: Record<string, number> };
  const arm = async (id: ContestPlayId, slot?: string | null) => {
    if (!ps?.ok) return;
    setBusy(true);
    const r = await contestArmPlay(leagueId, week, id, slot ?? null, ps.roster_id).catch((e) => ({ ok: false, error: friendlyError(e) } as PlayResult));
    setBusy(false); setArming(null);
    if (!r.ok) { setNote(r.error ?? 'Couldn’t play it.'); return; }
    setPlays(r.plays ?? []); if (r.inventory) setInventory(r.inventory);
    const def = contestPlayById(id);
    setNote(`✓ ${def?.icon ?? ''} ${def?.name ?? id} on${slot ? ` ${def?.target === 'opp' ? 'their ' : ''}${labels[slot] ?? slot}` : ' your squad'}`);
    void read();
  };
  const disarm = async (x: ContestPlayRow) => {
    if (!ps?.ok) return;
    setBusy(true);
    const r = await contestDisarmPlay(leagueId, week, x.id, x.slot, ps.roster_id).catch((e) => ({ ok: false, error: friendlyError(e) } as PlayResult));
    setBusy(false);
    if (!r.ok) { setNote(r.error ?? 'Couldn’t take it back.'); return; }
    setPlays(r.plays ?? []); if (r.inventory) setInventory(r.inventory);
    setNote(`✓ ${contestPlayById(x.id)?.name ?? x.id} back in your hand${x.id === 'ghost' ? ' — fill the spot on MY TEAM' : ''}`);
    void read();
  };
  const cap = ps?.play_cap ?? contestPlayCap(st.format ?? 'h2h');
  const armingDef = arming ? contestPlayById(arming) : null;
  const hand: HandCard[] = myTable ? contestPlaysFor(st.format ?? 'h2h', st.contest ?? 'high').filter((d) => (inventory[d.id] ?? 0) > 0).map((d) => {
    const h = contestHandCard(d, { variant: st.variant, started: !!st.started, off: ps?.plays_off, plays, cap, busy });
    return { id: d.id, name: d.name, icon: d.icon, qty: inventory[d.id] ?? 0, action: h.action, deadline: h.deadline, blurb: d.blurb, usable: h.usable, note: h.note };
  }) : [];
  const scoreOf = (s: 'home' | 'away', slot: string) => m.state?.slots?.find((x) => x.side === s && x.slot === slot)?.score ?? null;
  // THE TIE-BREAKER SPOT (v0.681.0, founder: "the spot-specific tie breaker
  // target chip on the player spots in the matchup as well"): each squad's own
  // tie-breaker spot and target, dealt per seat; the number rides the card as a chip (v0.682.2).
  const tbs = {
    home: theCard ? contestTiebreak(leagueId, st.week ?? week, m.home, theCard, slots, contestRedeal(m.home_plays)) : null,
    away: theCard ? contestTiebreak(leagueId, st.week ?? week, m.away, theCard, slots, contestRedeal(m.away_plays)) : null,
  };
  // One card for a spot: yours deals in face up; another squad's turns face
  // up — the reveal flip — once its player has kicked off (contest_matchup
  // unseals him). Empty spots show a dashed outline.
  const cardInner = (s: 'home' | 'away', r: Row, mine: boolean, i: number, onPick?: () => void, hot = false) => {
    const p = r.slug ? bySlug.get(r.slug) : null;
    const tbc = tbs[s]?.slot === r.slot ? tbs[s] : null;
    // THE PLAYS (v0.685.0): the play on this spot (another's once the week has kicked off), the phantom as a card
    // mine on my spot, or the other side's aimed at it (Spy, Jinx) — once they show
    const pl = (s === 'home' ? m.home_plays : m.away_plays)?.find((x) => x.slot === r.slot && contestPlayById(x.id)?.target !== 'opp')
      ?? (s === 'home' ? m.away_plays : m.home_plays)?.find((x) => x.slot === r.slot && contestPlayById(x.id)?.target === 'opp') ?? null;
    // THE PENALTY CHIP (v0.685.2): a spot that posted nothing wears the dart's penalty, red
    const lvr = m.state?.slots?.find((x) => x.side === s && x.slot === r.slot);
    const pen = lvr?.aim?.penalty != null && Math.abs(lvr.score) < 1e-9 ? lvr.aim.penalty : null;
    if (r.slug) return <PlayerCard key={`${s}-${r.slot}-${r.slug}`} slug={r.slug} name={p?.name ?? r.slug} pos={p?.pos ?? 'FLEX'} team={p?.team ?? null} opp={!mine} idx={i} chip={pen != null ? `−${pen}` : tbc ? String(tbc.target) : null} chipTone={pen != null ? 'warn' : 'gold'} onChip={() => { if (pen == null) setTbNote(TB_NOTE); }} onClick={onPick} selected={hot} />;
    if (pl?.id === 'ghost') return <PlayerCard key={`${s}-${r.slot}-ghost`} slug={GHOST_PLAYER.id} name={GHOST_CARD.name} pos="FLEX" team={null} opp={!mine} idx={i} badge="👻" onClick={onPick} selected={hot} />;
    if (r.sealed) return <SealedCard key={`${s}-${r.slot}-sealed`} seed={`${m.id}|${s}|${r.slot}`} idx={i} tag={hot ? '▶ HERE' : false} onClick={onPick} />;
    return (
      <div key={`${s}-${r.slot}-empty`} className="ct-wrap" onClick={onPick} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', border: `1px dashed ${hot ? 'var(--you)' : 'color-mix(in srgb, var(--text) 25%, transparent)'}`, borderRadius: 10, cursor: onPick ? 'pointer' : 'default' }}>
        <span className="mono" style={{ fontSize: 9, color: hot ? 'var(--you)' : pen != null ? 'var(--warn, #c66)' : 'color-mix(in srgb, var(--text) 50%, transparent)', letterSpacing: '0.08em', fontWeight: pen != null ? 800 : 400 }}>{hot ? '▶ HERE' : pen != null ? `EMPTY · −${pen}` : 'EMPTY'}</span>
      </div>
    );
  };
  // While a play is aimed, only the spots it may land on now light up: mine for a spot play, theirs for Spy
  // and Jinx, each until that spot's player kicks off (contestSpotOpen, the twin of SQL _contest_play_window).
  const cardOf = (s: 'home' | 'away', r: Row, mine: boolean, i: number) => {
    const aimed = myTable && !!arming && !!armingDef && (armingDef.target === 'opp' ? !mine : mine);
    const open = aimed && contestSpotOpen(arming!, { slug: r.slug, locked: locked(r.slug) }, !!st.started);
    const el = cardInner(s, r, mine, i, open ? () => void arm(arming!, r.slot) : undefined, open);
    if (!myTable || !arming) return el;
    return <div key={`aim-${s}-${r.slot}`} style={{ opacity: open ? 1 : 0.35, transition: 'opacity .2s' }}>{el}</div>;
  };
  // THE NUMBERS (v0.678.0, founder: "the player score and projection to the
  // inside of the card columns in larger numbers"): the spot, the score once
  // his game is on, the projection under it; a Bullseye spot's target and how
  // far off. A sealed pick shows nothing — a projection would give him away.
  /** The play on a spot: mine on my spot, or the other side's aimed at it (Spy, Jinx) once it shows. */
  const playAt = (s: 'home' | 'away', r: Row): { pl: ContestPlayRow; theirs: boolean } | null => {
    const own = (s === 'home' ? m.home_plays : m.away_plays)?.find((x) => x.slot === r.slot && contestPlayById(x.id)?.target !== 'opp');
    if (own) return { pl: own, theirs: false };
    const aimed = (s === 'home' ? m.away_plays : m.home_plays)?.find((x) => x.slot === r.slot && contestPlayById(x.id)?.target === 'opp');
    return aimed ? { pl: aimed, theirs: true } : null;
  };
  const playText = (pl: ContestPlayRow, theirs: boolean, mine: boolean) => {
    const d = contestPlayById(pl.id);
    return `${theirs ? `${mine ? 'Their' : 'The other side’s'} ${d?.name ?? pl.id}, aimed at this spot.\n\n` : ''}${d?.blurb ?? ''}${pl.proj != null ? `\n\nHis number to beat: ${Number(pl.proj).toFixed(1)}.` : ''}${!theirs && mine ? '\n\nTake it back in PLAYS above until his kickoff.' : ''}`;
  };
  const numbersOf = (s: 'home' | 'away', r: Row, mine: boolean, edge: 'left' | 'right') => {
    const score = st.started ? scoreOf(s, r.slot) : null;   // an empty spot's zero row shows too (v0.695.0)
    const proj = r.slug ? projOf(r.slug) : null;
    const target = bull && !isTotal ? theCard?.targets[r.slot] ?? null : null;
    const color = mine ? 'var(--you)' : 'var(--opp)';
    return (
      <div style={{ display: 'grid', gap: 1, alignContent: 'center', textAlign: edge, padding: edge === 'left' ? '0 4px 0 10px' : '0 10px 0 4px', minWidth: 0 }}>
        {/* THE PLAY CHIP (v0.696.6, founder: "On the matchup screen, let's do the same: just an active power ups chip"):
            beside the spot's label, no icon on the card; tap it for the play's details. */}
        <span className="mono" style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.08em', color: 'color-mix(in srgb, var(--text) 65%, transparent)', display: 'flex', alignItems: 'center', gap: 5, justifyContent: edge === 'left' ? 'flex-start' : 'flex-end' }}>
          {`${labels[r.slot] ?? r.slot}${target != null ? ` · 🎯 ${target}` : ''}`}
          {(() => { const a = playAt(s, r); return a ? <InfoChip label="POWER UP" title={contestPlayById(a.pl.id)?.name ?? a.pl.id} info={playText(a.pl, a.theirs, mine)} /> : null; })()}
        </span>
        <span className="mono" style={{ fontSize: 28, fontWeight: 800, lineHeight: 1.05, color: score != null ? color : 'color-mix(in srgb, var(--text) 35%, transparent)' }}>{score != null ? score.toFixed(1) : r.sealed ? '◈' : '—'}</span>
        <span className="mono" style={{ fontSize: 11, color: 'color-mix(in srgb, var(--text) 65%, transparent)' }}>
          {proj != null && !r.sealed ? `proj ${proj.toFixed(1)}` : ''}
          {target != null && score != null ? ` · ${Math.abs(score - target).toFixed(1)} off` : ''}
        </span>
      </div>
    );
  };
  const fmt = (n: number | null) => (n == null ? '—' : Number(n).toFixed(1));
  // THE SCOREBOARD (v0.680.1, founder: "the current/projected score and
  // target/diff from target next to each other and prominent"): a side's
  // points so far and where they project to land (every spot's score, or its
  // projection until his game is on), and for Bullseye the ring — how far
  // off the target — with the projected ring beside it. A squad with a sealed
  // pick has no projection: adding his number would give him away.
  // THE RING (v0.682.5, founder: "where does the 57.4 come from?"): the
  // server's ring is the score the week is won on — in a one-team-total
  // league max(0, radius × spots − distance), so 90 − 32.6 = 57.4 at radius
  // 10 over nine spots; per spot, the sum of each spot's ring. The scoreboard
  // had labelled it OFF and projected a distance. Now: RING, the distance
  // and target under it, a projected RING beside it, and a side with spots
  // still to play says so (each carries the zero penalty until he posts).
  const radius = st.radius ?? 10;
  const tally = (s: 'home' | 'away', S: typeof L) => {
    let pts = 0, proj = 0, ringProj = 0, known = true, toPlay = 0;
    const bonusRows = (m.state?.slots ?? []).filter((x) => x.side === s && x.slot === 'PLAY');
    for (const b of bonusRows) { pts += b.score; proj += b.score; }
    for (const r of S.rows) {
      const score = st.started && r.slug ? scoreOf(s, r.slot) : null;
      if (score != null) pts += score;
      if (st.started && (r.sealed || (r.slug && score == null))) toPlay++;
      if (r.sealed) { known = false; continue; }
      const v = score ?? (r.slug ? projOf(r.slug) : null) ?? 0;
      proj += v;
      if (bull && !isTotal) { const tg = theCard?.targets[r.slot]; if (tg != null) ringProj += ringScore(v, tg, radius); }
    }
    const points = !bull ? S.score : st.started ? pts : null;
    const projected = known ? proj : null;
    // a one-team-total league's score IS the distance (v0.683.0): project that
    const ringProjected = !bull || !known ? null : isTotal ? (theCard ? Math.abs(proj - theCard.total) : null) : ringProj;
    return { points, projected, ring: bull ? S.score : null, ringProjected, toPlay, bonus: bonusRows.map((b) => `${contestPlayById(b.play ?? '')?.icon ?? '⚡'} ${b.score > 0 ? '+' : ''}${b.score}`).join(' ') };
  };
  const scoreboard = (s: 'home' | 'away', S: typeof L, edge: 'left' | 'right') => {
    const t = tally(s, S);
    const color = S.mine ? 'var(--you)' : 'var(--opp)';
    const dim = 'color-mix(in srgb, var(--text) 65%, transparent)';
    const big = { fontSize: 30, fontWeight: 800, lineHeight: 1.05 } as const;
    const cell = { display: 'grid', gap: 1, textAlign: edge } as const;
    return (
      <div style={{ display: 'grid', gap: 3, textAlign: edge, minWidth: 0 }}>
        <span className="mono" style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: S.mine ? 'var(--you)' : 'color-mix(in srgb, var(--text) 80%, transparent)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{`${S.team.toUpperCase()}${S.mine ? ' · YOU' : ''}`}</span>
        {/* the cells stack, always (v0.686.0, founder: "the scores always stacked in two rows") */}
        <div style={{ display: 'grid', gap: 6, justifyItems: edge === 'left' ? 'start' : 'end' }}>
          <div style={cell}>
            <span className="mono" style={{ ...big, color: t.points != null ? color : 'color-mix(in srgb, var(--text) 35%, transparent)' }}>{fmt(t.points)}</span>
            <span className="mono" style={{ fontSize: 10.5, color: dim }}>{`${bull ? 'PTS' : word.toUpperCase()}${t.projected != null ? ` · proj ${t.projected.toFixed(1)}` : ''}${t.bonus ? ` · ${t.bonus}` : ''}`}</span>
          </div>
          {bull && (
            <div style={cell}>
              <span className="mono" style={{ ...big, color: t.ring != null ? 'var(--text)' : 'color-mix(in srgb, var(--text) 35%, transparent)' }}>{fmt(t.ring)}</span>
              <span className="mono" style={{ fontSize: 10.5, color: dim }}>{`${isTotal ? `OFF 🎯 ${theCard?.total ?? ''}` : 'RING · 🎯 per spot'}${t.ringProjected != null ? ` · proj ${t.ringProjected.toFixed(1)}${isTotal ? ' off' : ''}` : ''}${t.toPlay ? ` · ${t.toPlay} to play` : ''}`}</span>
            </div>
          )}
        </div>
      </div>
    );
  };
  const others = (st.matchups ?? []).filter((x) => x.id !== m.id);
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <CardTableCss />
      {(st.matchups?.length ?? 0) > 1 && (
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', alignItems: 'center', paddingBottom: 4 }}>
          {(st.matchups ?? []).map((x) => (
            <button key={x.id} onClick={() => setPick(x.id === (st.matchups ?? []).find((y) => y.mine)?.id ? null : x.id)} className="mono" style={{ ...chip(x.id === m.id), flexShrink: 0, whiteSpace: 'nowrap' }}>
              {x.home === x.away ? x.home_team : `${x.home_team} v ${x.away_team}`}{x.mine ? ' · YOU' : ''}
            </button>
          ))}
        </div>
      )}
      {tbNote && (
        <div style={{ ...card, display: 'flex', gap: 10, alignItems: 'baseline' }}>
          <span className="mono" style={{ fontSize: 11.5, color: 'var(--dim)', flex: 1 }}>{tbNote}</span>
          <button onClick={() => setTbNote(null)} className="mono" style={chip(false)}>✕</button>
        </div>
      )}
      {myTable && (
        <div style={{ ...card, display: 'grid', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <span className="mono" style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--faint)' }}>PLAYS</span>
            <span className="mono" style={small}>{`${hand.reduce((a, c) => a + c.qty, 0)} in hand · ${plays.length} of ${cap} played`}</span>
            <InfoChip title="Plays" info={'Your hand sits at the foot of the screen. Tap a card to play it: a squad play goes on at once; a spot play lights up the spots it can land on — tap one. Only a player who hasn’t kicked off can take a play; the rest dim. TAKE BACK puts a play back in your hand on the same clock. Buy more in the shop on MY TEAM.'} />
            {arming && <button onClick={() => setArming(null)} className="mono" style={{ ...chip(true), marginLeft: 'auto' }}>{`▶ tap ${armingDef?.target === 'opp' ? 'one of their lit spots' : 'a lit spot'} for ${armingDef?.name ?? ''} · CANCEL`}</button>}
          </div>
          {arming && <span className="mono" style={small}>{armingDef?.blurb}</span>}
          {note && <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}><span className="mono" style={{ ...small, color: 'var(--dim)', flex: 1 }}>{note}</span><button onClick={() => setNote(null)} className="mono" style={chip(false)}>✕</button></div>}
          {plays.length > 0 && (
            <div className="mono" style={{ ...small, display: 'grid', gap: 3 }}>
              {plays.map((x) => (
                <div key={`${x.id}-${x.slot ?? ''}`} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span>{`${contestPlayById(x.id)?.icon ?? ''} ${contestPlayById(x.id)?.name ?? x.id}${x.slot ? ` on ${contestPlayById(x.id)?.target === 'opp' ? 'their ' : ''}${labels[x.slot] ?? x.slot}` : ''}${x.proj != null ? ` · beats ${Number(x.proj).toFixed(1)}` : ''}`}</span>
                  {(!st.started || !!x.slot) && <button disabled={busy} onClick={() => void disarm(x)} className="mono" style={chip(false)}>TAKE BACK</button>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <Felt>
        {/* the scoreboard: each side's points and projection, and for Bullseye how far off the target (v0.680.1) */}
        <div style={{ display: 'grid', gridTemplateColumns: solo ? '1fr' : 'minmax(0,1fr) minmax(0,1fr)', gap: 12, padding: '4px 8px 12px', borderBottom: '1px solid color-mix(in srgb, var(--text) 12%, transparent)', marginBottom: 8 }}>
          {scoreboard(left, L, 'left')}
          {!solo && scoreboard(right, R, 'right')}
        </div>
        {/* a row per spot: your card at the outer edge, the numbers inside, their numbers, their card at the far edge */}
        <div style={{ display: 'grid', gap: 9, padding: '4px 2px' }}>
          {slots.map((d, i) => {
            const lr = L.rows[i], rr = R.rows[i];
            return (
              <div key={d.slot} style={{ display: 'grid', gridTemplateColumns: solo ? '104px minmax(0,1fr)' : '104px minmax(0,1fr) minmax(0,1fr) 104px', alignItems: 'center', minHeight: 150 }}>
                {cardOf(left, lr, L.mine, i)}
                {numbersOf(left, lr, L.mine, 'left')}
                {!solo && numbersOf(right, rr, R.mine, 'right')}
                {!solo && cardOf(right, rr, R.mine, i)}
              </div>
            );
          })}
        </div>
      </Felt>
      {others.length > 0 && st.format !== 'board' && (
        <div className="mono" style={small}>{`${others.length} other matchup${others.length === 1 ? '' : 's'} this week — pick one above.`}</div>
      )}
      {/* THE HAND (v0.695.0): the plays in hand, fanned at the foot of the screen; a squad play goes on at once, a spot play lights its spots */}
      {hand.length > 0 && (
        <>
          <div style={{ height: 104 }} />
          <PowerupHand cards={hand} pendingId={arming}
            onArm={(id) => void arm(id as ContestPlayId)}
            onApply={(id) => { setArming(id as ContestPlayId); setNote(null); }}
            onCancel={() => setArming(null)} />
        </>
      )}
    </div>
  );
}
