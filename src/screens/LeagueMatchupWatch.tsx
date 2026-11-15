// WATCHING A MATCHUP YOU ARE NOT IN (v0.739.0). Founder, on the Drip board:
// "I think we need a way for players to browse to other matchups happening in
// the league this week." And how much a league-mate sees: "Full board after
// kickoff."
//
// Read only: this reads the worker's published window rows (matchup_state,
// open to the league since 0532) and lays them out with core's watchBoard —
// each window's battle, then each spot's two players, their metrics and their
// points. A window that has not kicked off has published nothing, so it is
// listed as sealed; no pick and no power-up is read at all. The phone draws
// the same rows on its duel cards (apps/mobile/src/ui/MatchupWatch.tsx).
import { useEffect, useMemo, useState } from 'react';
import {
  getMatchup, getMatchupState, matchupTeams, myPool, subscribeMatchup,
  type LiveMatchup, type PoolPlayer, type TeamInfo, type WindowScore,
} from '@drip/core/data/liveApi';
import { windowsForWeek, windowDateLabel, windowTimeLabel, windowPhase } from '@drip/core/data/nflSlate';
import { watchBoard, watchSealedWindows, type WatchCell } from '@drip/core/data/matchupWatch';
import { metricById } from '@drip/core/data/metrics';
import { nameFromSlug } from '@drip/core/data/players';
import { slugMeta } from '@drip/core/data/slugMeta';
import { GHOST_POINTS } from '@drip/core/engine/sim';
import type { Pos } from '@drip/core/types';
import { ModalBackdrop } from '../app/ui';

const fmt = (n: number) => n.toFixed(1);

export function LeagueMatchupWatch({ leagueId, matchupId, onClose }: { leagueId: string; matchupId: string; onClose: () => void }) {
  const [m, setM] = useState<LiveMatchup | null>(null);
  const [scores, setScores] = useState<WindowScore[]>([]);
  const [teams, setTeams] = useState<Record<number, TeamInfo>>({});
  const [pool, setPool] = useState<Record<string, PoolPlayer>>({});
  const [failed, setFailed] = useState(false);
  const [nowTs, setNowTs] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNowTs(Date.now()), 30_000); return () => clearInterval(id); }, []);

  useEffect(() => {
    let alive = true;
    let unsub = () => {};
    (async () => {
      try {
        const mm = await getMatchup(matchupId);
        if (!alive) return;
        if (!mm) { setFailed(true); return; }
        setM(mm);
        matchupTeams(leagueId, [mm.home_roster_id, mm.away_roster_id]).then((tm) => { if (alive) setTeams(tm); }).catch(() => {});
        Promise.all([myPool(leagueId, mm.week, mm.home_roster_id).catch(() => []), myPool(leagueId, mm.week, mm.away_roster_id).catch(() => [])])
          .then(([h, a]) => { if (alive) setPool(Object.fromEntries([...a, ...h].map((p) => [p.slug, p]))); }).catch(() => {});
        const refresh = async () => {
          const [m2, ss] = await Promise.all([getMatchup(matchupId), getMatchupState(matchupId)]);
          if (!alive) return;
          if (m2) setM(m2);
          setScores(ss);
        };
        await refresh();
        if (!alive) return;
        unsub = subscribeMatchup(matchupId, () => { refresh().catch(() => {}); });
      } catch { if (alive) setFailed(true); }
    })();
    return () => { alive = false; unsub(); };
  }, [leagueId, matchupId]);

  const week = m?.week ?? 0;
  const order = useMemo(() => (week ? windowsForWeek(week).map((w) => String(w.id)) : []), [week]);
  const board = useMemo(() => watchBoard(scores, order), [scores, order]);
  const sealed = useMemo(() => watchSealedWindows(scores, order), [scores, order]);
  const final = m?.status === 'final';
  const homeName = m ? teams[m.home_roster_id]?.team_name || `Seat ${m.home_roster_id}` : '';
  const awayName = m ? teams[m.away_roster_id]?.team_name || `Seat ${m.away_roster_id}` : '';
  const win = (id: string) => windowsForWeek(week).find((w) => String(w.id) === id);

  const cell = (c: WatchCell | null, right: boolean, kicked: boolean) => {
    const align = { flex: 1, minWidth: 0, textAlign: right ? 'right' : 'left' } as const;
    if (!c) return <div className="mono" style={{ ...align, fontSize: 10.5, color: 'var(--faint)' }}>{kicked ? 'no player' : 'sealed'}</div>;
    const pl = c.slug ? pool[c.slug] : null;
    const pos = (pl?.pos ?? (c.slug ? slugMeta(c.slug).pos : 'WR')) as Pos;
    const name = c.phantom === 'ghost' ? '👻 Ghost Player' : `${c.phantom === 'bye' ? '🛌 ' : ''}${pl?.full ?? (c.slug ? nameFromSlug(c.slug) : 'Bye player')}`;
    const sub = c.phantom === 'ghost' ? `banks a flat ${GHOST_POINTS}` : c.phantom === 'bye' ? 'bye steal · his projection, flat'
      : `${pos}${pl?.team ? ` · ${pl.team}` : ''} · ${metricById(pos, c.metric)?.name ?? c.metric ?? 'no metric'}`;
    return (
      <div style={align}>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}{c.hot ? ' 🔥' : ''}{c.nuked ? ' 💥' : ''}</div>
        <div className="mono" style={{ fontSize: 9.5, color: 'var(--dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</div>
        <div className="mono" style={{ fontSize: 16, fontWeight: 800, color: right ? 'var(--opp)' : 'var(--you)' }}>{fmt(c.score)}</div>
      </div>
    );
  };

  return (
    <ModalBackdrop onClick={onClose} padTop={40}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 620, maxHeight: '88vh', overflow: 'auto', background: 'var(--surface)', border: '1px solid var(--bdh)', borderRadius: 8, boxShadow: '0 24px 70px rgba(0,0,0,0.5)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '14px 16px', borderBottom: '1px solid var(--bd)' }}>
          <div className="mono" style={{ fontSize: 9, color: 'var(--dim)', letterSpacing: '0.1em' }}>WATCHING · READ ONLY{m ? ` · ${final ? 'FINAL' : m.status === 'live' ? '● LIVE' : 'NOT STARTED'}` : ''}</div>
          <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', color: 'var(--dim)', fontSize: 18, cursor: 'pointer' }}>✕</button>
        </div>
        {failed && <div className="mono" style={{ padding: 20, fontSize: 11, color: 'var(--faint)' }}>This matchup could not be read. Close this and try again.</div>}
        {!failed && !m && <div className="mono" style={{ padding: 20, fontSize: 11, color: 'var(--faint)' }}>Loading the matchup…</div>}
        {m && (
          <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', border: '1px solid var(--bd)', borderRadius: 8, background: 'var(--bg)' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="grotesk" style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{homeName}</div>
                <div className="mono" style={{ fontSize: 24, fontWeight: 800, color: 'var(--you)' }}>{fmt(board.home)}</div>
              </div>
              <div className="mono" style={{ fontSize: 10, color: 'var(--faint)' }}>vs</div>
              <div style={{ flex: 1, minWidth: 0, textAlign: 'right' }}>
                <div className="grotesk" style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{awayName}</div>
                <div className="mono" style={{ fontSize: 24, fontWeight: 800, color: 'var(--opp)' }}>{fmt(board.away)}</div>
              </div>
            </div>

            {board.windows.map((w) => {
              const ph = windowPhase(week, w.win as never, nowTs, { matchupFinal: final });
              const done = ph === 'final';
              const even = Math.abs(w.home - w.away) < 0.05;
              const lead = w.home > w.away ? homeName : awayName;
              const total = w.home + w.away;
              const pct = total > 0 ? Math.max(4, Math.min(96, (w.home / total) * 100)) : 50;
              return (
                <div key={w.win} style={{ border: '1px solid var(--bd)', borderRadius: 8, padding: '10px 12px', background: 'var(--bg)' }}>
                  <div className="mono" style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', fontSize: 10, color: 'var(--dim)' }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{win(w.win)?.label ?? w.win.toUpperCase()}</span>
                    <span>{windowDateLabel(week, w.win as never)}</span>
                    <span style={{ color: 'var(--faint)' }}>{windowTimeLabel(week, w.win as never)}</span>
                    <span style={{ marginLeft: 'auto', fontWeight: 700, color: done ? 'var(--faint)' : 'var(--you)' }}>{done ? 'FINAL' : '● LIVE'}</span>
                  </div>
                  <div className="mono" style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '8px 0 4px', fontSize: 12, fontWeight: 700 }}>
                    <span style={{ color: 'var(--you)', minWidth: 38, textAlign: 'right' }}>{fmt(w.home)}</span>
                    <div style={{ flex: 1, height: 6, borderRadius: 4, overflow: 'hidden', background: 'var(--opp)' }}><div style={{ width: `${pct}%`, height: '100%', background: 'var(--you)' }} /></div>
                    <span style={{ color: 'var(--opp)', minWidth: 38 }}>{fmt(w.away)}</span>
                  </div>
                  <div className="mono" style={{ fontSize: 9, letterSpacing: '0.08em', color: 'var(--faint)', marginBottom: 8 }}>
                    ⚔ WINDOW BATTLE · {even ? (done ? 'EVEN' : 'DEAD EVEN') : done ? `★ ${lead.toUpperCase()} WON` : `${lead.toUpperCase()} LEAD`}
                  </div>
                  {w.spots.map((s) => (
                    <div key={s.slot} style={{ display: 'flex', gap: 12, padding: '8px 0', borderTop: '1px solid var(--bd)' }}>
                      {cell(s.home, false, true)}
                      {cell(s.away, true, true)}
                    </div>
                  ))}
                  {!w.spots.length && <div className="mono" style={{ fontSize: 10.5, color: 'var(--faint)' }}>Nobody fielded.</div>}
                </div>
              );
            })}

            {sealed.map((id) => {
              const ph = windowPhase(week, id as never, nowTs, { matchupFinal: final });
              const waiting = ph === 'setup' || ph === 'locked';
              return (
                <div key={id} className="mono" style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', border: '1px solid var(--bd)', borderRadius: 8, padding: '10px 12px', fontSize: 10, color: 'var(--dim)', opacity: 0.75 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{win(id)?.label ?? id.toUpperCase()}</span>
                  <span>{windowDateLabel(week, id as never)}</span>
                  <span style={{ color: 'var(--faint)' }}>{windowTimeLabel(week, id as never)}</span>
                  <span style={{ marginLeft: 'auto', fontWeight: 700, color: waiting ? 'var(--warn)' : 'var(--faint)' }}>{waiting ? '🔒 SEALED · shows at kickoff' : 'NOTHING PLAYED'}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </ModalBackdrop>
  );
}
