import { useEffect, useMemo, useState } from 'react';
import { WINDOWS, metricById } from '../data/metrics';
import { GameIcon, COIN_GOLD } from '../app/gameIcons';
import type { Pos } from '../types';
import {
  myRoster, myMatchup, getMatchup, getMatchupState, getRevealedPicks, subscribeMatchup, myPool, matchupWallets, matchupTeams, weekGameFeeds,
  type LiveMatchup, type WindowScore, type RevealedPick, type PoolPlayer, type TeamInfo, type GameFeedRow,
} from '../data/liveApi';
import { setLiveGameFeed, feedRowsToWeek } from '../data/gameFeed';
import { FieldView } from '../app/FieldView';
import { REG_SEASON_WEEKS } from '../data/league';

const card: React.CSSProperties = { background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 8, padding: 16 };
const linkBtn: React.CSSProperties = { background: 'none', border: 'none', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--dim)', cursor: 'pointer' };
const winLabel = (id: string) => WINDOWS.find((w) => w.id === id)?.label ?? id.toUpperCase();

export function LiveBoard({ userId, leagueId, rosterId, onBack }: { userId: string; leagueId?: string; rosterId?: number; onBack: () => void }) {
  const [matchup, setMatchup] = useState<LiveMatchup | null>(null);
  const [youAreHome, setYouAreHome] = useState(true);
  const [scores, setScores] = useState<WindowScore[]>([]);
  const [picks, setPicks] = useState<RevealedPick[]>([]);
  const [pool, setPool] = useState<Record<string, PoolPlayer>>({});
  const [wallets, setWallets] = useState<{ home: number | null; away: number | null } | null>(null);
  const [teams, setTeams] = useState<Record<number, TeamInfo>>({});
  const [state, setState] = useState<'loading' | 'none' | 'ready'>('loading');
  const [weekSel, setWeekSel] = useState<number | null>(null); // null = default (earliest) week
  const [gameFeeds, setGameFeeds] = useState<GameFeedRow[]>([]); // field visuals (game_feed)
  const [fieldsOpen, setFieldsOpen] = useState(true);

  useEffect(() => {
    let unsub = () => {};
    (async () => {
      setState('loading');
      const r = leagueId && rosterId != null ? { leagueId, rosterId } : await myRoster(userId);
      if (!r) { setState('none'); return; }
      const m = await myMatchup(r.leagueId, r.rosterId, weekSel ?? undefined);
      if (!m) { setMatchup(null); setState('none'); return; }
      setMatchup(m); setYouAreHome(m.home_roster_id === r.rosterId);
      const pl = await myPool(r.leagueId, m.week, r.rosterId);
      setPool(Object.fromEntries(pl.map((p) => [p.slug, p])));
      matchupTeams(r.leagueId, [m.home_roster_id, m.away_roster_id]).then(setTeams).catch(() => {});
      const refresh = async () => {
        const [mm, ss, pk, ww, gf] = await Promise.all([
          getMatchup(m.id), getMatchupState(m.id), getRevealedPicks(m.id), matchupWallets(m.id).catch(() => null),
          weekGameFeeds(m.week).catch(() => [] as GameFeedRow[]),
        ]);
        if (mm) setMatchup(mm);
        setScores(ss); setPicks(pk); setWallets(ww);
        // Install the worker's per-game feeds so FieldView resolves them (the
        // live overlay is exclusive per week — never baked data on a live board).
        setLiveGameFeed(m.week, feedRowsToWeek(gf));
        setGameFeeds(gf);
      };
      await refresh();
      setState('ready');
      unsub = subscribeMatchup(m.id, refresh); // live push on score/status change
    })();
    return () => unsub();
  }, [userId, leagueId, rosterId, weekSel]);

  const totals = useMemo(() => {
    const home = scores.reduce((t, s) => t + Number(s.home_score), 0);
    const away = scores.reduce((t, s) => t + Number(s.away_score), 0);
    return { you: youAreHome ? home : away, them: youAreHome ? away : home };
  }, [scores, youAreHome]);

  // Week stepper: page through the scheduled season's boards.
  const curWeek = matchup?.week ?? weekSel ?? 1;
  const weekNav = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
      <button onClick={() => setWeekSel(Math.max(1, curWeek - 1))} disabled={curWeek <= 1} className="mono" title="previous week" style={{ ...linkBtn, fontSize: 13, padding: '0 4px', opacity: curWeek <= 1 ? 0.35 : 1 }}>‹</button>
      <span className="mono" style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--dim)' }}>WK {curWeek}</span>
      <button onClick={() => setWeekSel(Math.min(REG_SEASON_WEEKS, curWeek + 1))} disabled={curWeek >= REG_SEASON_WEEKS} className="mono" title="next week" style={{ ...linkBtn, fontSize: 13, padding: '0 4px', opacity: curWeek >= REG_SEASON_WEEKS ? 0.35 : 1 }}>›</button>
    </div>
  );

  if (state === 'loading') return <Muted text="Loading the board…" />;
  if (state === 'none') return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <div className="grotesk" style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>No week {curWeek} matchup</div>
        {weekNav}
      </div>
      <div className="mono" style={{ fontSize: 10.5, color: 'var(--dim)', marginTop: 10 }}>Use ‹ › to page through the season, or check back once the schedule syncs.</div>
      <div style={{ textAlign: 'center', marginTop: 14 }}><button onClick={onBack} className="mono" style={linkBtn}>← back</button></div>
    </div>
  );

  const status = matchup!.status;
  const locked = status !== 'scheduled';
  const round = (n: number) => Math.round(n * 10) / 10;
  const mine = picks.filter((p) => p.app_user_id === userId);
  const theirs = picks.filter((p) => p.app_user_id !== userId);
  const myCoin = youAreHome ? matchup!.home_coin : matchup!.away_coin;
  const theirCoin = youAreHome ? matchup!.away_coin : matchup!.home_coin;
  const myBank = youAreHome ? wallets?.home : wallets?.away;
  const theirBank = youAreHome ? wallets?.away : wallets?.home;

  return (
    <div>
      <div style={{ ...card, marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="grotesk" style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>Week {matchup!.week} · live board</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            {weekNav}
            <span className="mono" style={{ fontSize: 9, color: status === 'final' ? 'var(--dim)' : status === 'scheduled' ? 'var(--faint)' : 'var(--you)', border: '1px solid var(--bd)', borderRadius: 4, padding: '3px 7px' }}>{status.toUpperCase()}</span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'center', gap: 18, margin: '16px 0 4px' }}>
          <Big label="YOU" value={round(totals.you)} color="var(--you)" team={teams[youAreHome ? matchup!.home_roster_id : matchup!.away_roster_id]} />
          <span className="mono" style={{ fontSize: 11, color: 'var(--faint)', paddingTop: 14 }}>vs</span>
          <Big label="OPP" value={round(totals.them)} color="var(--opp)" team={teams[youAreHome ? matchup!.away_roster_id : matchup!.home_roster_id]} />
        </div>
        {status === 'scheduled' && <div className="mono" style={{ fontSize: 9.5, color: 'var(--faint)', textAlign: 'center', marginTop: 8 }}>Scores start ticking after kickoff.</div>}
        {(myCoin != null || theirCoin != null) && (
          <div className="mono" style={{ display: 'flex', justifyContent: 'center', gap: 18, fontSize: 9.5, color: 'var(--faint)', marginTop: 8 }}>
            <span style={{ color: 'var(--you)' }}><GameIcon src={COIN_GOLD} size="1.3em" /> {round(Number(myCoin ?? 0))} this week</span>
            <span style={{ color: 'var(--opp)' }}><GameIcon src={COIN_GOLD} size="1.3em" /> {round(Number(theirCoin ?? 0))}</span>
          </div>
        )}
        {(myBank != null || theirBank != null) && (
          <div className="mono" style={{ display: 'flex', justifyContent: 'center', gap: 18, fontSize: 9.5, color: 'var(--faint)', marginTop: 4 }}>
            <span style={{ color: 'var(--you)' }}><GameIcon src={COIN_GOLD} size="1.3em" /> {round(Number(myBank ?? 0))} banked</span>
            <span style={{ color: 'var(--opp)' }}><GameIcon src={COIN_GOLD} size="1.3em" /> {round(Number(theirBank ?? 0))}</span>
          </div>
        )}
      </div>

      {scores.length > 0 && (
        <div style={{ ...card, marginBottom: 12 }}>
          <div className="mono" style={{ fontSize: 10, letterSpacing: '0.12em', color: 'var(--dim)', fontWeight: 700, marginBottom: 8 }}>BY WINDOW</div>
          {scores.sort((a, b) => a.game_window.localeCompare(b.game_window)).map((s) => {
            const you = youAreHome ? s.home_score : s.away_score;
            const them = youAreHome ? s.away_score : s.home_score;
            return (
              <div key={s.game_window} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--bd)' }}>
                <span style={{ color: Number(you) >= Number(them) ? 'var(--you)' : 'var(--text)', fontWeight: 700, fontSize: 13, width: 50, textAlign: 'right' }}>{round(Number(you))}</span>
                <span className="mono" style={{ fontSize: 10, color: 'var(--dim)', flex: 1, textAlign: 'center', alignSelf: 'center' }}>{winLabel(s.game_window)}</span>
                <span style={{ color: Number(them) > Number(you) ? 'var(--opp)' : 'var(--text)', fontWeight: 700, fontSize: 13, width: 50 }}>{round(Number(them))}</span>
              </div>
            );
          })}
        </div>
      )}

      {(() => {
        // Every NFL game the worker has plays for this week, as drive charts —
        // the same FieldView as the full board, always showing the latest play.
        const games = gameFeeds.filter((g) => g.plays.length > 0).sort((a, b) => a.key.localeCompare(b.key));
        if (!games.length) return null;
        return (
          <div style={{ ...card, marginBottom: 12 }}>
            <button onClick={() => setFieldsOpen((o) => !o)} className="mono" style={{ display: 'flex', width: '100%', justifyContent: 'space-between', alignItems: 'center', background: 'none', border: 'none', padding: 0, fontSize: 10, letterSpacing: '0.12em', color: 'var(--dim)', fontWeight: 700 }}>
              <span>⬢ AROUND THE LEAGUE · {games.length} GAME{games.length > 1 ? 'S' : ''}</span>
              <span>{fieldsOpen ? '▴' : '▾'}</span>
            </button>
            {fieldsOpen && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 300px), 1fr))', gap: 8, marginTop: 8 }}>
                {games.map((g) => <FieldView key={g.key} week={matchup!.week} team={g.away} clock={Number.MAX_SAFE_INTEGER} />)}
              </div>
            )}
          </div>
        );
      })()}

      <Lineup title="Your lineup" picks={mine} pool={pool} reveal />
      <Lineup title={locked ? 'Opponent lineup' : 'Opponent — sealed'} picks={theirs} pool={pool} reveal={locked} />

      <div style={{ textAlign: 'center', marginTop: 14 }}><button onClick={onBack} className="mono" style={linkBtn}>← back</button></div>
    </div>
  );
}

function Big({ label, value, color, team }: { label: string; value: number; color: string; team?: TeamInfo }) {
  return (
    <div style={{ textAlign: 'center', maxWidth: 120 }}>
      {team?.avatar && <img src={team.avatar} alt="" width={28} height={28} style={{ borderRadius: 6, marginBottom: 4 }} />}
      <div className="grotesk" style={{ fontSize: 38, fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
      <div className="mono" style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '0.12em', marginTop: 4 }}>{label}</div>
      {team?.team_name && <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{team.team_name}</div>}
    </div>
  );
}

function Lineup({ title, picks, pool, reveal }: { title: string; picks: RevealedPick[]; pool: Record<string, PoolPlayer>; reveal: boolean }) {
  if (picks.length === 0 && reveal) return null;
  return (
    <div style={{ ...card, marginBottom: 10 }}>
      <div className="mono" style={{ fontSize: 10, letterSpacing: '0.12em', color: 'var(--dim)', fontWeight: 700, marginBottom: 8 }}>{title.toUpperCase()}</div>
      {!reveal ? (
        <div className="mono" style={{ fontSize: 10.5, color: 'var(--faint)' }}>Hidden until kickoff.</div>
      ) : picks.length === 0 ? (
        <div className="mono" style={{ fontSize: 10.5, color: 'var(--faint)' }}>No sealed picks (plays their Sleeper lineup).</div>
      ) : (
        picks.sort((a, b) => a.game_window.localeCompare(b.game_window)).map((p, i) => {
          const player = p.player_slug ? pool[p.player_slug] : null;
          const metric = player ? metricById(player.pos as Pos, p.metric_id) : null;
          return (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid var(--bd)' }}>
              <span style={{ fontSize: 12, color: 'var(--text)' }}>{player?.full ?? p.player_slug ?? '—'}</span>
              <span className="mono" style={{ fontSize: 9.5, color: 'var(--dim)' }}>{winLabel(p.game_window)} · {metric?.name ?? p.metric_id ?? '—'}</span>
            </div>
          );
        })
      )}
    </div>
  );
}

function Muted({ text }: { text: string }) {
  return <div className="mono" style={{ textAlign: 'center', fontSize: 11, color: 'var(--dim)' }}>{text}</div>;
}
