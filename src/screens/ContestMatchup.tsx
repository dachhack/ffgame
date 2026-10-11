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
import { contestMatchup, podSalaries, type ContestMatchupState, type PodSalaryRow } from '@drip/core/data/liveApi';
import { contestSlotLabels, CONTEST_SCORE_WORD } from '@drip/core/engine/contest';
import { classicSlotsFromSpec } from '@drip/core/engine/classic';
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

export function ContestMatchup({ leagueId, week }: { leagueId: string; week: number }) {
  const [st, setSt] = useState<ContestMatchupState | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [board, setBoard] = useState<PodSalaryRow[]>([]);
  useEffect(() => {
    let alive = true;
    const read = () => contestMatchup(leagueId, week, pick).then((r) => { if (alive) setSt(r); }).catch(() => {});
    void read();
    const id = setInterval(read, 60_000);
    return () => { alive = false; clearInterval(id); };
  }, [leagueId, week, pick]);
  useEffect(() => { podSalaries(week).then(setBoard).catch(() => setBoard([])); }, [week]);
  const bySlug = useMemo(() => new Map(board.map((r) => [r.slug, r])), [board]);
  const slots = useMemo(() => classicSlotsFromSpec(st?.slots ?? null) ?? [], [st?.slots]);
  const labels = useMemo(() => contestSlotLabels(slots), [slots]);
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
  const column = (s: 'home' | 'away', rows: Row[], mine: boolean) => rows.map((r, i) => {
    const p = r.slug ? bySlug.get(r.slug) : null;
    const bank = st.started ? scoreOf(s, r.slot) : null;
    if (r.slug) {
      // My own card deals in face up; another squad's turns face up — the
      // reveal flip — once its player has kicked off (contest_matchup unseals him).
      return <PlayerCard key={`${s}-${r.slot}-${r.slug}`} slug={r.slug} name={p?.name ?? r.slug} pos={p?.pos ?? 'FLEX'} team={p?.team ?? null} slot={labels[r.slot] ?? r.slot} bank={bank} opp={!mine} idx={i} />;
    }
    if (r.sealed) return <SealedCard key={`${s}-${r.slot}-sealed`} seed={`${m.id}|${s}|${r.slot}`} idx={i} />;
    return (
      <div key={`${s}-${r.slot}-empty`} className="ct-wrap" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px dashed rgba(255,255,255,0.25)', borderRadius: 10 }}>
        <span className="mono" style={{ fontSize: 9, color: 'rgba(255,255,255,0.5)', letterSpacing: '0.08em' }}>{`${labels[r.slot] ?? r.slot} · EMPTY`}</span>
      </div>
    );
  });
  const fmt = (n: number | null) => (n == null ? '—' : Number(n).toFixed(1));
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
        <span className="mono" style={{ fontSize: 12 }}>
          <b style={{ color: L.mine ? 'var(--you)' : 'var(--text)' }}>{L.team}</b>{` ${fmt(L.score)} ${word}`}
          {!solo && <>{' · '}<b style={{ color: R.mine ? 'var(--you)' : 'var(--text)' }}>{R.team}</b>{` ${fmt(R.score)} ${word}`}</>}
        </span>
        {!solo && !st.started && <span className="mono" style={{ ...small, marginLeft: 'auto' }}>{`${R.mine ? 'Your' : 'Their'} cards turn face up as each player's game kicks off.`}</span>}
      </div>
      <Felt>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', alignItems: 'flex-start', padding: '10px 4px' }}>
          <div className="ct-col">{column(left, L.rows, L.mine)}</div>
          {!solo && (
            {/* the kit's ct-mid pads 34px for the drip board's header row; here the labels sit level with the cards */}
            <div className="ct-mid" style={{ paddingTop: 0, gap: 9 }}>
              {slots.map((d) => <div key={d.slot} className="mono" style={{ height: 150, display: 'flex', alignItems: 'center', fontSize: 9.5, fontWeight: 700, letterSpacing: '0.08em', color: 'rgba(255,255,255,0.7)' }}>{labels[d.slot] ?? d.slot}</div>)}
            </div>
          )}
          {!solo && <div className="ct-col">{column(right, R.rows, R.mine)}</div>}
        </div>
      </Felt>
      {others.length > 0 && st.format !== 'board' && (
        <div className="mono" style={small}>{`${others.length} other matchup${others.length === 1 ? '' : 's'} this week — pick one above.`}</div>
      )}
    </div>
  );
}
