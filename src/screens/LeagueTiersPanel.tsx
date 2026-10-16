// TIERS INSIDE ONE LEAGUE (0507, v0.728.0) — the commissioner's panel and the
// members' table, on the web; the phone's twin is apps/mobile/src/ui/LeagueTiers.
// Founder: "Lets also make within season within league relegation."
import { useEffect, useState } from 'react';
import { leagueTiers, setLeagueTiers, leagueStandings, type StandingsRow } from '@drip/core/data/liveApi';
import { TIER_PERIODS, TIER_MOVERS, TIERS_INFO, tierZone, periodLabel, lastTierMovesLine, type LeagueTiersState } from '@drip/core/data/leagueTiers';
import { card, mono, btn, subhead, errMsg, InfoChip, LabelInfo } from './adminUi';

const row: React.CSSProperties = { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' };

/** The commissioner's panel: on/off, the tier order, the period and the movers. */
export function TiersPanel({ leagueId }: { leagueId: string }) {
  const [st, setSt] = useState<LeagueTiersState | null>(null);
  const [labels, setLabels] = useState<string[] | null>(null);
  const [allLabeled, setAllLabeled] = useState(false);
  const [period, setPeriod] = useState(4);
  const [movers, setMovers] = useState(2);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = async () => {
    const [s, rows] = await Promise.all([leagueTiers(leagueId), leagueStandings(leagueId)]);
    setSt(s);
    const rs = Array.isArray(rows) ? (rows as StandingsRow[]) : [];
    const divs = [...new Set(rs.map((r) => r.division).filter((d): d is string => !!d))];
    setAllLabeled(rs.length > 0 && rs.every((r) => !!r.division));
    setLabels(s.on && s.tiers?.length ? s.tiers.map((x) => x.tier) : divs.sort());
    if (s.on) { setPeriod(s.period ?? 4); setMovers(s.movers ?? 2); }
  };
  useEffect(() => { load().catch((e) => setMsg(errMsg(e))); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [leagueId]);

  const run = async (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => {
    if (busy) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fn();
      if (r.ok) { setMsg(`✓ ${done}`); await load(); } else setMsg(r.error ?? 'failed');
    } catch (e) { setMsg(errMsg(e)); }
    finally { setBusy(false); }
  };
  const move = (i: number, d: -1 | 1) => {
    if (!labels) return;
    const j = i + d; if (j < 0 || j >= labels.length) return;
    const n = [...labels]; [n[i], n[j]] = [n[j], n[i]]; setLabels(n);
  };

  if (!st || !labels) return <div style={card}><span className="mono" style={{ ...mono, fontSize: 11, color: 'var(--faint)' }}>{msg ?? 'loading…'}</span></div>;
  const ready = allLabeled && labels.length >= 2;
  return (
    <div style={card}>
      <LabelInfo label="IN-SEASON TIERS" title="In-season tiers" info={TIERS_INFO} />
      <div className="mono" style={{ ...mono, fontSize: 11, color: st.on ? 'var(--you)' : 'var(--faint)' }}>{st.on ? `on · ${periodLabel(st)} · ${st.movers} up & down` : 'off'}</div>
      {msg && <div className="mono" style={{ ...mono, fontSize: 11, marginTop: 4, color: msg.startsWith('✓') ? 'var(--you)' : 'var(--opp)' }}>{msg}</div>}
      {!ready ? (
        <div className="mono" style={{ ...mono, fontSize: 11, color: 'var(--faint)', marginTop: 8 }}>Give every team a division first — at least two.</div>
      ) : (
        <>
          <div style={{ ...subhead, marginTop: 12 }}>TIERS, TOP FIRST</div>
          {labels.map((d, i) => (
            <div key={d} style={{ ...row, padding: '5px 0', borderTop: '1px solid var(--bd)' }}>
              <span className="mono" style={{ ...mono, fontSize: 11, fontWeight: 700, color: 'var(--faint)', width: 52 }}>TIER {i + 1}</span>
              <span style={{ flex: 1, fontSize: 13.5, color: 'var(--text)' }}>{d}</span>
              <button onClick={() => move(i, -1)} disabled={i === 0} className="mono" style={{ ...btn(), padding: '3px 8px', opacity: i === 0 ? 0.35 : 1 }}>▲</button>
              <button onClick={() => move(i, 1)} disabled={i === labels.length - 1} className="mono" style={{ ...btn(), padding: '3px 8px', opacity: i === labels.length - 1 ? 0.35 : 1 }}>▼</button>
            </div>
          ))}
          <div style={{ ...subhead, marginTop: 12 }}>WEEKS A PERIOD</div>
          <div style={row}>{TIER_PERIODS.map((n) => <button key={n} disabled={busy} onClick={() => setPeriod(n)} className="mono" style={btn(period === n)}>{n}</button>)}</div>
          <div style={{ ...subhead, marginTop: 12 }}>TEAMS UP &amp; DOWN</div>
          <div style={row}>{TIER_MOVERS.map((n) => <button key={n} disabled={busy} onClick={() => setMovers(n)} className="mono" style={btn(movers === n)}>{n}</button>)}</div>
          <div style={{ ...row, marginTop: 16 }}>
            <button disabled={busy} className="mono" style={btn(true)} onClick={() => {
              if (!window.confirm(`${st.on ? 'Save the tiers' : 'Turn tiers on'}?\n\nThe schedule is rebuilt from the next week that hasn’t started, inside the tiers. A lineup already saved for those weeks is set again.`)) return;
              void run(() => setLeagueTiers(leagueId, true, period, movers, labels), st.on ? 'tiers saved' : 'tiers on');
            }}>{st.on ? 'SAVE TIERS' : 'TURN TIERS ON'}</button>
            {st.on && <button disabled={busy} className="mono" style={{ ...btn(), color: 'var(--opp)' }} onClick={() => {
              if (!window.confirm('Turn tiers off? The rest of the regular season is scheduled across the whole league again, from the next week that hasn’t started.')) return;
              void run(() => setLeagueTiers(leagueId, false), 'tiers off');
            }}>TURN TIERS OFF</button>}
          </div>
        </>
      )}
    </div>
  );
}

/** The members' table: each tier this period, ▲ and ▼ for who'd move if it
 *  ended now. Nothing when tiers are off. */
export function TiersCard({ leagueId, myRoster }: { leagueId: string; myRoster?: number | null }) {
  const [st, setSt] = useState<LeagueTiersState | null>(null);
  useEffect(() => { leagueTiers(leagueId).then(setSt).catch(() => {}); }, [leagueId]);
  if (!st?.on || !st.tiers?.length) return null;
  const mv = st.movers ?? 2;
  return (
    <div style={{ marginTop: 22 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <div className="grotesk" style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)' }}>Tiers</div>
        <span className="mono" style={{ ...mono, fontSize: 11, color: 'var(--dim)' }}>{`${periodLabel(st)} · ${mv} up & down`}</span>
        <InfoChip title="In-season tiers" info={TIERS_INFO} />
      </div>
      {st.tiers.map((tr, ti) => (
        <div key={tr.tier} style={{ marginTop: 8 }}>
          <div className="mono" style={{ ...mono, fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--you)' }}>{`TIER ${tr.rank} · ${tr.tier.toUpperCase()}`}</div>
          {tr.teams.map((m, i) => {
            const z = tierZone(ti, st.tiers!.length, i, tr.teams.length, mv);
            const mine = myRoster != null && m.roster_id === myRoster;
            return (
              <div key={m.roster_id} style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '5px 0', borderTop: '1px solid var(--bd)' }}>
                <span className="mono" style={{ ...mono, fontSize: 11, color: 'var(--faint)', width: 16 }}>{i + 1}</span>
                <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: mine ? 'var(--you)' : 'var(--text)', fontWeight: mine ? 700 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.team}</span>
                <span className="mono" style={{ ...mono, fontSize: 11, color: 'var(--dim)' }}>{`${m.wins}-${m.losses} · ${Number(m.points).toFixed(1)}`}</span>
                <span className="mono" style={{ ...mono, fontSize: 12, fontWeight: 700, width: 14, textAlign: 'right', color: z === 'up' ? 'var(--you)' : z === 'down' ? 'var(--opp)' : 'var(--faint)' }}>{z === 'up' ? '▲' : z === 'down' ? '▼' : ''}</span>
              </div>
            );
          })}
        </div>
      ))}
      {lastTierMovesLine(st) && <div className="mono" style={{ ...mono, fontSize: 11, color: 'var(--faint)', marginTop: 6 }}>{lastTierMovesLine(st)}</div>}
    </div>
  );
}
