// THE SPORT WEEK (0398) — what a daily-sport league's classic board shows
// above its lineup: the period's dates, both seats' locked slot-days with
// the line each player posted, the running totals (or the category verdict),
// and the slate for today.
//
// The NFL board scores from injected plays; a sport league's week is the
// sum of its locked slot-days, read from sport_matchup_lines and scored
// through the same core functions the worker uses (sports/score.ts), so the
// number on the board is the number in matchup_state.
import { useEffect, useMemo, useState } from 'react';
import { SPORTS, type Sport } from '@drip/core/sports/index';
import { linePoints, normalizeScoring, categoryTotals, compareCategories, categoryValue, categoryById } from '@drip/core/sports/score';
import { sportPeriod, type SportLeagueSettings } from '@drip/core/sports/league';
import { sportMatchupLines, sportLeagueGames, type SportMatchupLine, type SportGameRow } from '@drip/core/data/liveApi';
import { PosPill } from '../app/ui';

const MONO = 'var(--mono, ui-monospace, SFMono-Regular, Menlo, monospace)';

const fmtDay = (d: string) => {
  const t = new Date(`${d}T12:00:00Z`);
  return t.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric', timeZone: 'UTC' });
};
const fmtTip = (iso: string | null) => {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  return new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }).replace(' ', '').toLowerCase();
};
const r1 = (n: number) => Math.round(n * 10) / 10;

export function SportWeekPanel({ leagueId, matchupId, week, sport, settings, homeRosterId, awayRosterId, myRosterId, names }: {
  leagueId: string; matchupId: string; week: number; sport: Sport; settings: SportLeagueSettings;
  homeRosterId: number; awayRosterId: number; myRosterId: number | null;
  names?: Record<number, string>;
}) {
  const def = SPORTS[sport];
  const period = useMemo(() => sportPeriod(week, settings.period_start), [week, settings.period_start]);
  const [rows, setRows] = useState<SportMatchupLine[]>([]);
  const [games, setGames] = useState<SportGameRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    sportMatchupLines(matchupId).then((r) => { if (alive) { setRows(r ?? []); setErr(null); } }).catch((e) => { if (alive) setErr(String(e?.message ?? e)); });
    if (period) sportLeagueGames(leagueId, period.from, period.to).then((g) => { if (alive) setGames(g ?? []); }).catch(() => {});
    const id = window.setInterval(() => setTick((t) => t + 1), 60_000);
    return () => { alive = false; window.clearInterval(id); };
  }, [matchupId, leagueId, period?.from, period?.to, tick]);

  const scoring = useMemo(() => normalizeScoring(def, settings.scoring), [def, settings.scoring]);
  const side = (rid: number) => {
    const mine = rows.filter((r) => r.roster_id === rid);
    const days = mine.map((r) => ({ ...r, pts: r.line ? linePoints(def, r.line, scoring) : 0 }))
      .sort((a, b) => a.game_date.localeCompare(b.game_date) || a.roster_slot.localeCompare(b.roster_slot, undefined, { numeric: true }));
    const total = r1(days.reduce((t, d) => t + d.pts, 0));
    const totals = categoryTotals(def, mine.map((r) => r.line).filter((l): l is Record<string, number> => !!l));
    return { days, total, totals };
  };
  const home = side(homeRosterId), away = side(awayRosterId);
  const cats = settings.format === 'cats' && settings.categories.length
    ? compareCategories(def, home.totals, away.totals, settings.categories) : null;
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const slate = games.filter((g) => g.game_date === today);
  const lead = cats ? cats.winner : home.total === away.total ? 'tie' : home.total > away.total ? 'a' : 'b';
  const seatName = (rid: number) => names?.[rid] ?? `SEAT ${rid}`;
  const mineFirst = myRosterId === awayRosterId ? [away, home] : [home, away];
  const mineIds = myRosterId === awayRosterId ? [awayRosterId, homeRosterId] : [homeRosterId, awayRosterId];

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 10, padding: 12, display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <div className="mono" style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--dim)' }}>
          {def.league} · {period ? `${fmtDay(period.from)} – ${fmtDay(period.to)}` : `WEEK ${week}`} · {settings.format === 'cats' ? 'CATEGORIES' : 'POINTS'}
        </div>
        <div className="mono" style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>
          {cats ? `${cats.wins}-${cats.losses}-${cats.ties}` : `${home.total.toFixed(1)} – ${away.total.toFixed(1)}`}
          <span style={{ fontSize: 9.5, color: 'var(--faint)', marginLeft: 6 }}>{lead === 'tie' ? 'LEVEL' : lead === 'a' ? `${seatName(homeRosterId)} LEADS` : `${seatName(awayRosterId)} LEADS`}</span>
        </div>
      </div>

      {err && <div className="mono" style={{ fontSize: 10, color: 'var(--opp)' }}>{err}</div>}

      {cats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 6 }}>
          {cats.cats.map((c) => {
            const cat = categoryById(def, c.id);
            const fmt = (v: number | null) => (v == null ? '—' : cat?.ratio ? v.toFixed(cat.ratio.decimals ?? 3) : String(v));
            return (
              <div key={c.id} className="mono" style={{ border: '1px solid var(--bd)', borderRadius: 6, padding: '5px 7px', fontSize: 10, background: c.result === 'a' ? 'color-mix(in srgb, var(--you) 12%, transparent)' : c.result === 'b' ? 'color-mix(in srgb, var(--opp) 12%, transparent)' : 'transparent' }}>
                <div style={{ color: 'var(--faint)', fontWeight: 700, letterSpacing: '0.08em' }}>{cat?.short ?? c.id}</div>
                <div style={{ color: 'var(--text)' }}>{fmt(c.a)} <span style={{ color: 'var(--faint)' }}>·</span> {fmt(c.b)}</div>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10 }}>
        {mineFirst.map((s, i) => (
          <div key={mineIds[i]}>
            <div className="mono" style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.1em', color: mineIds[i] === myRosterId ? 'var(--you)' : 'var(--opp)', marginBottom: 5 }}>
              {seatName(mineIds[i])} · {s.total.toFixed(1)}
            </div>
            {s.days.length === 0 ? (
              <div className="mono" style={{ fontSize: 10, color: 'var(--faint)' }}>Nothing locked yet — a player locks into your lineup when his game tips off.</div>
            ) : (
              <div style={{ display: 'grid', gap: 3 }}>
                {s.days.map((d) => (
                  <div key={`${d.game_date}-${d.roster_slot}`} className="mono" style={{ display: 'grid', gridTemplateColumns: '58px 34px minmax(0, 1fr) 44px', alignItems: 'center', gap: 6, fontSize: 10.5 }}>
                    <span style={{ color: 'var(--faint)' }}>{fmtDay(d.game_date)}</span>
                    <PosPill pos={d.pos ?? d.roster_slot} />
                    <span style={{ color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {d.full_name ?? d.player_slug} <span style={{ color: 'var(--faint)' }}>{d.team}</span>
                      {d.status === 'live' && <span style={{ color: 'var(--you)', marginLeft: 4 }}>●</span>}
                    </span>
                    <span style={{ textAlign: 'right', fontWeight: 700, color: d.line ? 'var(--text)' : 'var(--faint)' }}>{d.line ? d.pts.toFixed(1) : 'DNP'}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {slate.length > 0 && (
        <div>
          <div className="mono" style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--dim)', marginBottom: 4 }}>TODAY'S {def.league} SLATE</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {slate.map((g) => (
              <span key={g.game_id} className="mono" style={{ fontFamily: MONO, fontSize: 10, border: '1px solid var(--bd)', borderRadius: 5, padding: '3px 6px', color: g.status === 'live' ? 'var(--you)' : 'var(--dim)' }}>
                {g.away} @ {g.home} · {g.status === 'pre' ? fmtTip(g.start_utc) : g.status === 'live' ? `${g.away_score ?? 0}-${g.home_score ?? 0} ${g.clock ?? ''}` : g.status === 'final' ? `F ${g.away_score ?? 0}-${g.home_score ?? 0}` : g.status.toUpperCase()}
              </span>
            ))}
          </div>
        </div>
      )}
      <div className="mono" style={{ fontSize: 9.5, color: 'var(--faint)', lineHeight: 1.5 }}>
        Set the lineup below any time. A player locks in the slot he is in when his game starts and scores that day's line; a slot with no game today scores nothing until it has one.
        {settings.format === 'points' ? ` Points: ${Object.entries(scoring).filter(([, v]) => v).slice(0, 6).map(([k, v]) => `${def.stats.find((s) => s.id === k)?.short ?? k} ${v}`).join(', ')}.` : ''}
        {' '}Ratios: {def.categories.filter((c) => c.ratio && settings.categories.includes(c.id)).map((c) => `${c.short} ${categoryValue(c, home.totals) ?? '—'} · ${categoryValue(c, away.totals) ?? '—'}`).join('  ')}
      </div>
    </div>
  );
}
