import { useEffect, useRef, useState } from 'react';
import { useStore } from '../app/store';
import { ThemeSwitcher } from '../app/ui';
import { getStandings, sleeperAvatarUrl, type SleeperStanding } from '../data/sleeper';
import { buildSleeperLeague } from '../data/buildLeague';

// A background build either resolves to the engine-ready league or carries its
// error — it never rejects, so a prefetch the user never triggers can't warn.
type BuildOutcome =
  | { ok: true; built: Awaited<ReturnType<typeof buildSleeperLeague>>['built']; youTeamId: string }
  | { ok: false; error: unknown };

function buildErrorCopy(e: unknown): string {
  const msg = (e instanceof Error ? e.message : String(e)).toLowerCase();
  const isDirectory = (e instanceof Error && e.name === 'AbortError') || msg.includes('player directory') || msg.includes('directory');
  return isDirectory
    ? 'Couldn’t download the Sleeper player directory (~15MB) — check your connection and try again.'
    : 'Couldn’t build the sim for this league. Try again.';
}

export function SleeperLeague({ leagueId, leagueName }: { leagueId: string; leagueName: string }) {
  const { navigate, sleeperUser, loadSimLeague } = useStore();
  const [rows, setRows] = useState<SleeperStanding[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [simErr, setSimErr] = useState<string | null>(null);
  const [addKdst, setAddKdst] = useState(true);
  // Background build, keyed by the addKdst it was built with, so RUN MY SEASON is
  // near-instant (the heavy work overlaps with reading the standings).
  const buildRef = useRef<{ addKdst: boolean; p: Promise<BuildOutcome> } | null>(null);

  const startBuild = (kdst: boolean) => {
    if (!sleeperUser) return;
    const p: Promise<BuildOutcome> = buildSleeperLeague(leagueId, sleeperUser.userId, setNote, { addKdst: kdst })
      .then((r) => ({ ok: true as const, built: r.built, youTeamId: r.youTeamId }))
      .catch((error) => ({ ok: false as const, error }));
    buildRef.current = { addKdst: kdst, p };
  };

  const runSim = async () => {
    if (!sleeperUser || busy) return;
    setBusy(true); setSimErr(null);
    try {
      // Reuse the prefetched build when the K/DST choice hasn't changed.
      if (!buildRef.current || buildRef.current.addKdst !== addKdst) startBuild(addKdst);
      const outcome = await buildRef.current!.p;
      if (!outcome.ok) throw outcome.error;
      loadSimLeague(outcome.built, outcome.youTeamId);
      navigate({ name: 'hub' });
    } catch (e) {
      setSimErr(buildErrorCopy(e));
      setBusy(false);
      buildRef.current = null; // force a fresh build on retry
    }
  };

  useEffect(() => {
    let alive = true;
    setRows(null); setErr(null);
    startBuild(addKdst); // warm the build in the background, in parallel with standings
    getStandings(leagueId)
      .then((d) => { if (alive) setRows(d.standings); })
      .catch(() => { if (alive) setErr('Could not load this league from Sleeper.'); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId]);

  const mine = sleeperUser?.displayName?.toLowerCase();
  const myIdx = rows ? rows.findIndex((r) => mine && r.owner.toLowerCase() === mine) : -1;
  const myRow = myIdx >= 0 ? rows![myIdx] : null;

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 16px', borderBottom: '1px solid var(--bd)', flexWrap: 'wrap', gap: 10, position: 'sticky', top: 0, background: 'var(--bg)', zIndex: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <button onClick={() => navigate({ name: 'leagues' })} className="mono" style={{ fontSize: 9, letterSpacing: '0.1em', color: 'var(--dim)', background: 'var(--surface)', border: '1px solid var(--bd)', padding: '6px 9px', borderRadius: 4, cursor: 'pointer' }}>← LEAGUES</button>
          <span className="grotesk" style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{leagueName}</span>
        </div>
        <ThemeSwitcher />
      </header>

      <main style={{ flex: 1, overflow: 'auto', padding: '20px 16px 60px' }}>
        <div style={{ maxWidth: 800, margin: '0 auto' }}>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--bd)', borderLeft: '3px solid var(--you)', borderRadius: 6, padding: '14px', marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ minWidth: 0 }}>
              <div className="grotesk" style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{myRow ? 'Run your season' : 'Run the season sim'}</div>
              <div style={{ fontSize: 11.5, color: 'var(--dim)', marginTop: 4, lineHeight: 1.5 }}>
                {busy ? (note || 'Building…')
                  : myRow
                    ? <>You’re <span style={{ color: 'var(--text)', fontWeight: 700 }}>{myRow.teamName}</span> — seeded #{myIdx + 1}, {myRow.wins}-{myRow.losses}{myRow.ties ? `-${myRow.ties}` : ''}. Replay your real 2025 season through the drip game.</>
                    : 'Replays your real 2025 season through the 14-week drip game — real scores, real matchups, your roster.'}
              </div>
              <button
                type="button"
                onClick={() => setAddKdst((v) => !v)}
                disabled={busy}
                className="mono"
                title="Adds a real K and DST to any team missing one, so the kicker/defense metrics are playable. Leagues that already roster them are untouched."
                style={{ display: 'inline-flex', alignItems: 'center', gap: 7, marginTop: 10, background: 'transparent', border: 'none', padding: 0, cursor: busy ? 'default' : 'pointer', color: 'var(--dim)' }}
              >
                <span style={{ width: 30, height: 17, borderRadius: 999, background: addKdst ? 'var(--you)' : 'var(--bd)', position: 'relative', transition: 'background 120ms', flex: 'none' }}>
                  <span style={{ position: 'absolute', top: 2, left: addKdst ? 15 : 2, width: 13, height: 13, borderRadius: '50%', background: 'var(--on-accent)', transition: 'left 120ms' }} />
                </span>
                <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.04em', color: addKdst ? 'var(--text)' : 'var(--dim)' }}>
                  ADD K &amp; DST TO ROSTERS MISSING THEM
                </span>
              </button>
              {simErr && <div className="mono" style={{ fontSize: 10.5, color: 'var(--opp)', marginTop: 6 }}>{simErr}</div>}
            </div>
            <button onClick={runSim} disabled={busy} className="mono" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--on-accent)', background: 'var(--you)', border: 'none', borderRadius: 6, padding: '11px 18px', cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1, whiteSpace: 'nowrap' }}>
              {busy ? '…' : myRow ? '▶ RUN MY SEASON' : '▶ RUN SIM'}
            </button>
          </div>

          <div className="mono" style={{ fontSize: 10, letterSpacing: '0.16em', color: 'var(--faint)', margin: '4px 0 10px' }}>STANDINGS</div>
          {err && <div className="mono" style={{ fontSize: 12, color: 'var(--opp)' }}>{err}</div>}
          {!rows && !err && <div className="mono" style={{ fontSize: 12, color: 'var(--dim)', letterSpacing: '0.08em' }}>LOADING…</div>}
          {rows && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {rows.map((r, i) => {
                const isMe = mine && r.owner.toLowerCase() === mine;
                const av = sleeperAvatarUrl(r.avatar);
                return (
                  <div key={r.rosterId} style={{ display: 'grid', gridTemplateColumns: '26px 1fr auto auto', gap: 10, alignItems: 'center', background: isMe ? 'color-mix(in srgb, var(--you) 10%, var(--surface))' : 'var(--surface)', border: `1px solid ${isMe ? 'color-mix(in srgb, var(--you) 45%, transparent)' : 'var(--bd)'}`, borderRadius: 4, padding: '8px 11px' }}>
                    <span className="grotesk" style={{ fontSize: 13, fontWeight: 700, color: 'var(--faint)', textAlign: 'center' }}>{i + 1}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      {av
                        ? <img src={av} alt="" width={24} height={24} style={{ borderRadius: '50%', flex: 'none' }} />
                        : <span style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--sh)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: 'var(--you)', flex: 'none' }} className="grotesk">{r.teamName.slice(0, 1).toUpperCase()}</span>}
                      <div style={{ minWidth: 0 }}>
                        <div className="grotesk" style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.teamName}</div>
                        <div className="mono" style={{ fontSize: 8.5, color: 'var(--faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.owner}</div>
                      </div>
                    </div>
                    <span className="mono" style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap' }}>{r.wins}-{r.losses}{r.ties ? `-${r.ties}` : ''}</span>
                    <span className="mono" style={{ fontSize: 10, color: 'var(--dim)', whiteSpace: 'nowrap', textAlign: 'right', minWidth: 92 }}>{r.pf.toFixed(1)} PF · {r.pa.toFixed(1)} PA</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
