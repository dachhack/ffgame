import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../app/store';
import { ThemeSwitcher } from '../app/ui';
import { getLeagues, sleeperAvatarUrl, type SleeperLeague } from '../data/sleeper';
import { prefetchPlayerDirectory } from '../data/sleeperPlayers';

// Leagues we've already auto-forwarded into (single-league shortcut). Tracked so
// pressing "← LEAGUES" from that league shows the (1-item) list instead of
// instantly bouncing back in.
const autoEntered = new Set<string>();

// The base league type (drops the "· Superflex" sub-tag), for filtering.
const baseType = (lg: SleeperLeague) => lg.format.split(' · ')[0];
// Display order for the filter chips.
const TYPE_ORDER = ['Dynasty', 'Keeper', 'Redraft', 'Best Ball'];

export function Leagues() {
  const { navigate, sleeperUser } = useStore();
  const [leagues, setLeagues] = useState<SleeperLeague[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('All');

  // Type chips present in this user's leagues, in a stable order.
  const types = useMemo(() => {
    const set = new Set((leagues ?? []).map(baseType));
    return TYPE_ORDER.filter((t) => set.has(t)).concat([...set].filter((t) => !TYPE_ORDER.includes(t)));
  }, [leagues]);
  const shown = useMemo(
    () => (leagues ?? []).filter((lg) => filter === 'All' || baseType(lg) === filter),
    [leagues, filter],
  );

  useEffect(() => {
    if (!sleeperUser) { navigate({ name: 'splash' }); return; }
    let alive = true;
    setLeagues(null); setErr(null);
    prefetchPlayerDirectory(); // backstop: warm the directory if we booted straight here
    getLeagues(sleeperUser.userId)
      .then((ls) => {
        if (!alive) return;
        // One league? Skip the list and drop them straight in (first visit only —
        // so a back-tap can still reach the list/switch user).
        if (ls.length === 1 && !autoEntered.has(ls[0].leagueId)) {
          autoEntered.add(ls[0].leagueId);
          navigate({ name: 'sleeperLeague', leagueId: ls[0].leagueId, leagueName: ls[0].name });
          return;
        }
        setLeagues(ls);
      })
      .catch(() => { if (alive) setErr('Could not load leagues from Sleeper.'); });
    return () => { alive = false; };
  }, [sleeperUser]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!sleeperUser) return null;
  const av = sleeperAvatarUrl(sleeperUser.avatar);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 16px', borderBottom: '1px solid var(--bd)', flexWrap: 'wrap', gap: 10, position: 'sticky', top: 0, background: 'var(--bg)', zIndex: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <span className="grotesk" style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--text)', whiteSpace: 'nowrap' }}>◈ DRIP LEAGUE FF</span>
          {/* Username chip — tap to switch Sleeper user */}
          <button onClick={() => navigate({ name: 'splash' })} title="Switch Sleeper user" className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 999, padding: '4px 10px 4px 4px', cursor: 'pointer', minWidth: 0 }}>
            {av
              ? <img src={av} alt="" width={22} height={22} style={{ borderRadius: '50%', flex: 'none' }} />
              : <span style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--sh)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: 'var(--you)', flex: 'none' }}>{sleeperUser.displayName.slice(0, 1).toUpperCase()}</span>}
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 140 }}>{sleeperUser.displayName}</span>
            <span style={{ fontSize: 8.5, color: 'var(--faint)', letterSpacing: '0.08em' }}>▾</span>
          </button>
        </div>
        <ThemeSwitcher />
      </header>

      <main style={{ flex: 1, overflow: 'auto', padding: '20px 16px 60px' }}>
        <div style={{ maxWidth: 1000, margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
            <div className="grotesk" style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)' }}>Your 2025 Leagues</div>
            {leagues && <span className="mono" style={{ fontSize: 10, color: 'var(--faint)', letterSpacing: '0.08em' }}>{shown.length} LEAGUE{shown.length === 1 ? '' : 'S'}{filter !== 'All' ? '' : ' · NFL'}</span>}
          </div>

          {/* Type filter chips (only shown when there's more than one type) */}
          {leagues && types.length > 1 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
              {['All', ...types].map((t) => {
                const active = filter === t;
                const n = t === 'All' ? leagues.length : leagues.filter((lg) => baseType(lg) === t).length;
                return (
                  <button
                    key={t}
                    onClick={() => setFilter(t)}
                    className="mono"
                    style={{
                      fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', cursor: 'pointer',
                      color: active ? 'var(--on-accent)' : 'var(--dim)',
                      background: active ? 'var(--you)' : 'var(--surface)',
                      border: `1px solid ${active ? 'var(--you)' : 'var(--bd)'}`,
                      borderRadius: 999, padding: '5px 11px',
                    }}
                  >
                    {t.toUpperCase()} <span style={{ opacity: 0.6 }}>{n}</span>
                  </button>
                );
              })}
            </div>
          )}

          {err && <div className="mono" style={{ fontSize: 12, color: 'var(--opp)' }}>{err}</div>}
          {!leagues && !err && <div className="mono" style={{ fontSize: 12, color: 'var(--dim)', letterSpacing: '0.08em' }}>Loading {sleeperUser.displayName}’s leagues…</div>}
          {leagues && leagues.length === 0 && <div className="mono" style={{ fontSize: 12, color: 'var(--dim)' }}>No 2025 NFL leagues found for this user.</div>}

          {leagues && leagues.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
              {shown.map((lg) => {
                const la = sleeperAvatarUrl(lg.avatar);
                return (
                  <button
                    key={lg.leagueId}
                    onClick={() => navigate({ name: 'sleeperLeague', leagueId: lg.leagueId, leagueName: lg.name })}
                    style={{ textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 10, background: 'var(--surface)', border: '1px solid var(--bd)', borderLeft: '3px solid var(--you)', borderRadius: 6, padding: 14, cursor: 'pointer' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                      {la
                        ? <img src={la} alt="" width={36} height={36} style={{ borderRadius: 7, flex: 'none' }} />
                        : <span style={{ width: 36, height: 36, borderRadius: 7, background: 'var(--sh)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: 'var(--you)', flex: 'none' }} className="grotesk">{lg.name.slice(0, 1).toUpperCase()}</span>}
                      <div style={{ minWidth: 0 }}>
                        <div className="grotesk" style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lg.name}</div>
                        <div className="mono" style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '0.06em', marginTop: 2 }}>{lg.totalRosters}-TEAM{lg.status === 'complete' ? ' · COMPLETE' : lg.status === 'in_season' ? ' · IN SEASON' : ''}</div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                      <span className="mono" style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.04em', color: 'var(--you)', border: '1px solid color-mix(in srgb, var(--you) 40%, transparent)', background: 'color-mix(in srgb, var(--you) 10%, transparent)', borderRadius: 3, padding: '2px 6px' }}>{lg.format}</span>
                      <span className="mono" style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.04em', color: 'var(--dim)', border: '1px solid var(--bd)', borderRadius: 3, padding: '2px 6px' }}>{lg.scoring}</span>
                      <span className="mono" style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.04em', color: 'var(--dim)', border: '1px solid var(--bd)', borderRadius: 3, padding: '2px 6px' }}>{lg.starters} STARTERS</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
