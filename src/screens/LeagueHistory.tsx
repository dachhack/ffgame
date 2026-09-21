// 🏛 THE LEAGUE'S HISTORY, on the web (0324) — the app's twin
// (apps/mobile/src/ui/LeagueHistory.tsx), kept in step by hand.
//
// Three questions, in the order a league argues about them: who has won it,
// who has been the best at it, and what is the biggest thing anybody has ever
// done in it. So: the champions band, the all-time manager table (champions
// first, because that is the argument), then the record book — and last, a
// season picker for the detail nobody needs until they do.
//
// A league in its first season still gets all of this; it is just short. The
// server decides what counts (regular-season finals for records, playoff
// weeks for single-week scores, preseason nowhere) — this only draws it.
import { useEffect, useState } from 'react';
import { leagueHistory, type LeagueHistory as History, type HistorySeason } from '@drip/core/data/liveApi';

const card: React.CSSProperties = {
  background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 8, padding: 12, marginBottom: 12,
};
const hdr: React.CSSProperties = { fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--dim)', marginBottom: 8 };
const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderTop: '1px solid var(--bd)' };
const cell: React.CSSProperties = { flex: 1, minWidth: 0, fontSize: 12, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
const num: React.CSSProperties = { fontSize: 10.5, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap' };
const faint: React.CSSProperties = { fontSize: 9.5, color: 'var(--faint)', whiteSpace: 'nowrap' };
const pts = (n: number) => Math.round(n * 10) / 10;

export function LeagueHistory({ leagueId }: { leagueId: string }) {
  const [h, setH] = useState<History | null>(null);
  const [season, setSeason] = useState<string | null>(null);

  useEffect(() => {
    let on = true;
    leagueHistory(leagueId).then((r) => { if (on) setH(r); }).catch(() => { if (on) setH({ error: 'could not load' }); });
    return () => { on = false; };
  }, [leagueId]);

  if (!h) return <div className="mono" style={{ fontSize: 10.5, color: 'var(--faint)' }}>Loading…</div>;
  if (h.error || !h.ok) return <div className="mono" style={{ fontSize: 10.5, color: 'var(--opp)' }}>{h.error ?? 'No history yet.'}</div>;

  const seasons = h.seasons ?? [];
  const champs = seasons.filter((s) => s.champion);
  const recs = h.records;
  const shown: HistorySeason | undefined =
    seasons.find((s) => s.season === season) ?? seasons[0];
  // Nothing has ever finished: a league mid-first-season. Say so plainly
  // rather than drawing five empty tables.
  const anyGames = seasons.some((s) => (s.table ?? []).length > 0);

  return (
    <div>
      {/* ── THE CHAMPIONS. A band rather than a table: one line per title is
          the thing people screenshot. ── */}
      <div style={card}>
        <div style={hdr}>🏆 CHAMPIONS</div>
        {champs.length === 0 && (
          <div className="mono" style={{ fontSize: 10.5, color: 'var(--faint)', lineHeight: 1.5 }}>
            No champion yet — the first one is written the week your playoffs end.
          </div>
        )}
        {champs.map((s) => (
          <div key={s.league_id} style={row}>
            <span className="mono" style={{ fontSize: 11, fontWeight: 700, color: 'var(--warn)', width: 44 }}>{s.season}</span>
            <span style={{ ...cell, fontWeight: 700 }}>🏆 {s.champion?.team ?? `Team ${s.champion?.roster_id}`}</span>
            {s.runner_up && <span style={faint}>beat {s.runner_up.team ?? `Team ${s.runner_up.roster_id}`}</span>}
          </div>
        ))}
      </div>

      {/* ── ALL-TIME. Champions first — that is the argument this table is
          for — then wins, then points. ── */}
      {(h.managers ?? []).length > 0 && anyGames && (
        <div style={card}>
          <div style={hdr}>👑 ALL-TIME</div>
          <div style={{ ...row, borderTop: 'none', paddingBottom: 2 }}>
            <span className="mono" style={{ ...faint, flex: 1 }}>MANAGER</span>
            <span className="mono" style={{ ...faint, width: 34, textAlign: 'right' }}>SZNS</span>
            <span className="mono" style={{ ...faint, width: 58, textAlign: 'right' }}>RECORD</span>
            <span className="mono" style={{ ...faint, width: 62, textAlign: 'right' }}>POINTS</span>
            <span className="mono" style={{ ...faint, width: 46, textAlign: 'right' }}>TITLES</span>
          </div>
          {(h.managers ?? []).map((m) => (
            <div key={m.manager} style={row}>
              <span style={cell}>{m.team ?? m.manager}</span>
              <span className="mono" style={{ ...num, width: 34, textAlign: 'right', color: 'var(--dim)' }}>{m.seasons}</span>
              <span className="mono" style={{ ...num, width: 58, textAlign: 'right' }}>{m.w}-{m.l}{m.t ? `-${m.t}` : ''}</span>
              <span className="mono" style={{ ...num, width: 62, textAlign: 'right', color: 'var(--dim)' }}>{pts(m.pf)}</span>
              <span className="mono" style={{ ...num, width: 46, textAlign: 'right', color: m.titles > 0 ? 'var(--warn)' : 'var(--faint)' }}>
                {m.titles > 0 ? '🏆'.repeat(Math.min(m.titles, 3)) : '—'}{m.titles > 3 ? `×${m.titles}` : ''}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ── THE RECORD BOOK. ── */}
      {recs && anyGames && (
        <div style={card}>
          <div style={hdr}>📖 THE RECORD BOOK</div>
          <RecordList title="BIGGEST WEEKS" rows={(recs.top_weeks ?? []).slice(0, 5).map((r) => ({
            key: `${r.season}-${r.week}-${r.roster_id}`,
            left: `${r.team ?? `Team ${r.roster_id}`}`,
            right: `${pts(r.points)}`,
            sub: `${r.season} wk ${r.week}${r.playoff ? ' · playoff' : ''}${r.opp ? ` vs ${r.opp}` : ''}`,
          }))} />
          <RecordList title="BIGGEST BEATINGS" rows={(recs.blowouts ?? []).slice(0, 3).map((r, i) => ({
            key: `b${i}`, left: `${r.winner} over ${r.loser}`, right: `+${pts(r.margin)}`,
            sub: `${r.season} wk ${r.week} · ${r.score}`,
          }))} />
          <RecordList title="CLOSEST CALLS" rows={(recs.nailbiters ?? []).slice(0, 3).map((r, i) => ({
            key: `n${i}`, left: `${r.winner} over ${r.loser}`, right: `${pts(r.margin)}`,
            sub: `${r.season} wk ${r.week} · ${r.score}`,
          }))} />
          <RecordList title="BEST SEASONS (POINTS)" rows={(recs.top_seasons ?? []).slice(0, 3).map((r, i) => ({
            key: `s${i}`, left: r.team ?? `Team ${r.roster_id}`, right: `${pts(r.pf)}`,
            sub: `${r.season} · ${r.record}`,
          }))} />
          <RecordList title="BEST RECORDS" rows={(recs.best_records ?? []).slice(0, 3).map((r, i) => ({
            key: `r${i}`, left: r.team ?? `Team ${r.roster_id}`, right: r.record,
            sub: `${r.season} · ${pts(r.pf)} points`,
          }))} />
          <RecordList title="QUIETEST WEEKS" rows={(recs.low_weeks ?? []).slice(0, 3).map((r, i) => ({
            key: `l${i}`, left: r.team ?? `Team ${r.roster_id}`, right: `${pts(r.points)}`,
            sub: `${r.season} wk ${r.week}`,
          }))} />
        </div>
      )}

      {/* ── SEASON BY SEASON. Last, because it is the detail: the table as it
          finished, and that season's own high-water mark. ── */}
      {seasons.length > 0 && anyGames && shown && (
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
            <div style={{ ...hdr, marginBottom: 0, flex: 1 }}>🗓 SEASON BY SEASON</div>
            {seasons.map((s) => (
              <button key={s.league_id} onClick={() => setSeason(s.season)} className="mono"
                style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', padding: '3px 8px', borderRadius: 4, cursor: 'pointer',
                  background: shown.season === s.season ? 'color-mix(in srgb, var(--you) 16%, transparent)' : 'none',
                  border: `1px solid ${shown.season === s.season ? 'var(--you)' : 'var(--bd)'}`,
                  color: shown.season === s.season ? 'var(--you)' : 'var(--faint)' }}>
                {s.season}{s.current ? ' ·' : ''}
              </button>
            ))}
          </div>
          {shown.champion && (
            <div className="mono" style={{ fontSize: 10, color: 'var(--warn)', marginBottom: 4 }}>
              🏆 {shown.champion.team ?? `Team ${shown.champion.roster_id}`}
              {shown.runner_up ? ` · runner-up ${shown.runner_up.team ?? `Team ${shown.runner_up.roster_id}`}` : ''}
            </div>
          )}
          {shown.high_week && (
            <div className="mono" style={{ fontSize: 9.5, color: 'var(--faint)', marginBottom: 6 }}>
              High week: {shown.high_week.team ?? `Team ${shown.high_week.roster_id}`} · {pts(shown.high_week.points)} in wk {shown.high_week.week}
            </div>
          )}
          {(shown.table ?? []).length === 0
            ? <div className="mono" style={{ fontSize: 10.5, color: 'var(--faint)' }}>Nothing final yet this season.</div>
            : (shown.table ?? []).map((r, i) => (
              <div key={r.roster_id} style={row}>
                <span className="mono" style={{ fontSize: 10, color: 'var(--faint)', width: 16 }}>{i + 1}</span>
                <span style={cell}>{r.team ?? `Team ${r.roster_id}`}</span>
                <span className="mono" style={{ ...num, width: 58, textAlign: 'right' }}>{r.w}-{r.l}{r.t ? `-${r.t}` : ''}</span>
                <span className="mono" style={{ ...faint, width: 62, textAlign: 'right' }}>{pts(r.pf)} PF</span>
              </div>
            ))}
        </div>
      )}

      {!anyGames && (
        <div className="mono" style={{ fontSize: 10.5, color: 'var(--faint)', lineHeight: 1.6 }}>
          The record book fills itself as weeks go final — come back after your first Sunday.
        </div>
      )}
    </div>
  );
}

/** One record-book block: a heading and up to a handful of lines. Renders
 *  nothing at all when the league has none of that kind yet, which is what
 *  keeps a first-season book short rather than empty. */
function RecordList({ title, rows }: { title: string; rows: { key: string; left: string; right: string; sub: string }[] }) {
  if (rows.length === 0) return null;
  return (
    <div style={{ marginTop: 10 }}>
      <div className="mono" style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--faint)' }}>{title}</div>
      {rows.map((r) => (
        <div key={r.key} style={row}>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ fontSize: 11.5, color: 'var(--text)' }}>{r.left}</span>
            <span className="mono" style={{ display: 'block', fontSize: 9, color: 'var(--faint)' }}>{r.sub}</span>
          </span>
          <span className="mono" style={{ fontSize: 12, fontWeight: 700, color: 'var(--you)' }}>{r.right}</span>
        </div>
      ))}
    </div>
  );
}
