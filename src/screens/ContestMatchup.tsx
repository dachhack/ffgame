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
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { contestMatchup, podSalaries, weekSlateByTeam, type ContestMatchupState, type PodSalaryRow, type SlateSpot } from '@drip/core/data/liveApi';
import { contestSlotLabels, contestCard, contestTiebreak, CONTEST_SCORE_WORD } from '@drip/core/engine/contest';
import { ringFromDist, ringScore } from '@drip/core/engine/bullseye';
import { leagueWeekProj } from '@drip/core/engine/contestBuilder';
import { classicSlotsFromSpec, type ClassicScoring } from '@drip/core/engine/classic';
import { leagueCatalogOf } from '@drip/core/engine/projScoring';
import { CardTableCss, Felt, PlayerCard, SealedCard } from '../app/cardTable';

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
  useEffect(() => {
    let alive = true;
    const read = () => contestMatchup(leagueId, week, pick).then((r) => { if (alive) setSt(r); }).catch(() => {});
    void read();
    const id = setInterval(read, 60_000);
    return () => { alive = false; clearInterval(id); };
  }, [leagueId, week, pick]);
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
  if (!st) return <div className="mono" style={{ padding: 24, ...small }}>Loading…</div>;
  if (!st.ok) return <div style={{ padding: 24 }}><div className="mono" style={{ color: 'var(--warn, #c66)', fontSize: 12 }}>{st.error}</div></div>;
  const m = st.matchup;
  const word = CONTEST_SCORE_WORD[st.contest ?? 'high'];
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
  const scoreOf = (s: 'home' | 'away', slot: string) => m.state?.slots?.find((x) => x.side === s && x.slot === slot)?.score ?? null;
  // THE TIE-BREAKER SPOT (v0.681.0, founder: "the spot-specific tie breaker
  // target chip on the player spots in the matchup as well"): each squad's own
  // tie-breaker spot and target, dealt per seat; the number rides the card as a chip (v0.682.2).
  const tbs = {
    home: theCard ? contestTiebreak(leagueId, st.week ?? week, m.home, theCard, slots) : null,
    away: theCard ? contestTiebreak(leagueId, st.week ?? week, m.away, theCard, slots) : null,
  };
  // One card for a spot: yours deals in face up; another squad's turns face
  // up — the reveal flip — once its player has kicked off (contest_matchup
  // unseals him). Empty spots show a dashed outline.
  const cardOf = (s: 'home' | 'away', r: Row, mine: boolean, i: number) => {
    const p = r.slug ? bySlug.get(r.slug) : null;
    const tbc = tbs[s]?.slot === r.slot ? tbs[s] : null;
    if (r.slug) return <PlayerCard key={`${s}-${r.slot}-${r.slug}`} slug={r.slug} name={p?.name ?? r.slug} pos={p?.pos ?? 'FLEX'} team={p?.team ?? null} opp={!mine} idx={i} chip={tbc ? String(tbc.target) : null} onChip={() => setTbNote(TB_NOTE)} />;
    if (r.sealed) return <SealedCard key={`${s}-${r.slot}-sealed`} seed={`${m.id}|${s}|${r.slot}`} idx={i} tag={false} />;
    return (
      <div key={`${s}-${r.slot}-empty`} className="ct-wrap" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px dashed color-mix(in srgb, var(--text) 25%, transparent)', borderRadius: 10 }}>
        <span className="mono" style={{ fontSize: 9, color: 'color-mix(in srgb, var(--text) 50%, transparent)', letterSpacing: '0.08em' }}>EMPTY</span>
      </div>
    );
  };
  // THE NUMBERS (v0.678.0, founder: "the player score and projection to the
  // inside of the card columns in larger numbers"): the spot, the score once
  // his game is on, the projection under it; a Bullseye spot's target and how
  // far off. A sealed pick shows nothing — a projection would give him away.
  const numbersOf = (s: 'home' | 'away', r: Row, mine: boolean, edge: 'left' | 'right') => {
    const score = st.started && r.slug ? scoreOf(s, r.slot) : null;
    const proj = r.slug ? projOf(r.slug) : null;
    const target = bull && !isTotal ? theCard?.targets[r.slot] ?? null : null;
    const color = mine ? 'var(--you)' : 'var(--opp)';
    return (
      <div style={{ display: 'grid', gap: 1, alignContent: 'center', textAlign: edge, padding: edge === 'left' ? '0 4px 0 10px' : '0 10px 0 4px', minWidth: 0 }}>
        <span className="mono" style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.08em', color: 'color-mix(in srgb, var(--text) 65%, transparent)' }}>{`${labels[r.slot] ?? r.slot}${target != null ? ` · 🎯 ${target}` : ''}`}</span>
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
    const dist = bull && isTotal && theCard && points != null ? Math.abs(points - theCard.total) : null;
    const ringProjected = !bull || !known ? null : isTotal ? (theCard ? ringFromDist(Math.abs(proj - theCard.total), radius * Math.max(1, slots.length)) : null) : ringProj;
    return { points, projected, ring: bull ? S.score : null, ringProjected, dist, toPlay };
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
        <div style={{ display: 'flex', gap: 18, alignItems: 'flex-end', flexWrap: 'wrap', flexDirection: edge === 'left' ? 'row' : 'row-reverse' }}>
          <div style={cell}>
            <span className="mono" style={{ ...big, color: t.points != null ? color : 'color-mix(in srgb, var(--text) 35%, transparent)' }}>{fmt(t.points)}</span>
            <span className="mono" style={{ fontSize: 10.5, color: dim }}>{`${bull ? 'PTS' : word.toUpperCase()}${t.projected != null ? ` · proj ${t.projected.toFixed(1)}` : ''}`}</span>
          </div>
          {bull && (
            <div style={cell}>
              <span className="mono" style={{ ...big, color: t.ring != null ? 'var(--text)' : 'color-mix(in srgb, var(--text) 35%, transparent)' }}>{fmt(t.ring)}</span>
              <span className="mono" style={{ fontSize: 10.5, color: dim }}>{`RING${t.dist != null && theCard ? ` · ${t.dist.toFixed(1)} off 🎯 ${theCard.total}` : isTotal ? '' : ' · 🎯 per spot'}${t.ringProjected != null ? ` · proj ${t.ringProjected.toFixed(1)}` : ''}${t.toPlay ? ` · ${t.toPlay} to play` : ''}`}</span>
            </div>
          )}
        </div>
      </div>
    );
  };
  const status = m.status === 'final' ? 'FINAL' : st.started ? 'LIVE' : 'SQUADS LOCK AT EACH KICKOFF';
  const others = (st.matchups ?? []).filter((x) => x.id !== m.id);
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <CardTableCss />
      {(st.matchups?.length ?? 0) > 1 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="mono" style={small}>{st.format === 'board' ? 'SQUADS' : 'MATCHUPS'}</span>
          {(st.matchups ?? []).map((x) => (
            <button key={x.id} onClick={() => setPick(x.id === (st.matchups ?? []).find((y) => y.mine)?.id ? null : x.id)} className="mono" style={chip(x.id === m.id)}>
              {x.home === x.away ? x.home_team : `${x.home_team} v ${x.away_team}`}{x.mine ? ' · YOU' : ''}
            </button>
          ))}
        </div>
      )}
      <div style={{ ...card, display: 'flex', gap: 16, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <span className="mono" style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--you)' }}>{m.label ? `${m.label.toUpperCase()} · ${status}` : status}</span>
        {!solo && <span className="mono" style={small}>{`${L.team} v ${R.team}`}</span>}
        {!solo && !st.started && <span className="mono" style={{ ...small, marginLeft: 'auto' }}>{`${R.mine ? 'Your' : 'Their'} cards turn face up as each player's game kicks off.`}</span>}
      </div>
      {tbNote && (
        <div style={{ ...card, display: 'flex', gap: 10, alignItems: 'baseline' }}>
          <span className="mono" style={{ fontSize: 11.5, color: 'var(--dim)', flex: 1 }}>{tbNote}</span>
          <button onClick={() => setTbNote(null)} className="mono" style={chip(false)}>✕</button>
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
    </div>
  );
}
