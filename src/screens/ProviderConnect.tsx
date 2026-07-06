import { useState } from 'react';
import { useStore } from '../app/store';
import { SiteSettings, VersionTag } from '../app/ui';
import { getProvider, espnAuth, type ProviderId } from '../data/providers';

// Generic "connect a league by id" screen for providers that aren't Sleeper
// (ESPN, Fleaflicker, MFL). These have no public username lookup, so the flow is
// league-id-centric. ESPN additionally collects espn_s2 + SWID for private
// leagues; the others need only the league id (+ season).
export function ProviderConnect({ provider }: { provider: ProviderId }) {
  const prov = getProvider(provider);
  const { navigate, loadSimLeague } = useStore();
  const [leagueId, setLeagueId] = useState('');
  const [season, setSeason] = useState('2025');
  const [s2, setS2] = useState('');
  const [swid, setSwid] = useState('');
  const [addKdst, setAddKdst] = useState(true);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const needsCookies = prov.auth === 'cookie';

  const submit = async () => {
    const id = leagueId.trim();
    if (!id || busy) return;
    setBusy(true); setErr(null);
    try {
      const auth = provider === 'espn'
        ? espnAuth({ swid: swid.trim(), s2: s2.trim(), season: season.trim() })
        : { season: season.trim() };
      const { built, youTeamId } = await prov.buildLeague(id, '', setNote, { addKdst, auth });
      loadSimLeague(built, youTeamId);
      navigate({ name: 'hub' });
    } catch (e) {
      setErr(e instanceof Error ? e.message : `Could not load that ${prov.label} league.`);
      setBusy(false);
    }
  };

  const field: React.CSSProperties = { width: '100%', boxSizing: 'border-box', fontFamily: 'inherit', fontSize: 14, color: 'var(--text)', background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 5, padding: '10px 12px', outline: 'none' };
  const label: React.CSSProperties = { fontSize: 9, letterSpacing: '0.14em', color: 'var(--faint)', fontWeight: 700, display: 'block', marginBottom: 5 };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 16px', borderBottom: '1px solid var(--bd)', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <button onClick={() => navigate({ name: 'splash' })} className="mono" style={{ fontSize: 9, letterSpacing: '0.1em', color: 'var(--dim)', background: 'var(--surface)', border: '1px solid var(--bd)', padding: '6px 9px', borderRadius: 4, cursor: 'pointer' }}>← BACK</button>
          <span className="grotesk" style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>Connect a {prov.label} league</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <VersionTag />
          <SiteSettings />
        </div>
      </header>

      <main style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 16px' }}>
        <div style={{ width: '100%', maxWidth: 460 }}>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--bd)', borderLeft: '3px solid var(--you)', borderRadius: 8, padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 2 }}>
                <label className="mono" style={label}>LEAGUE ID</label>
                <input value={leagueId} autoFocus onChange={(e) => { setLeagueId(e.target.value); setErr(null); }} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} placeholder="from your league URL" inputMode="numeric" style={field} />
              </div>
              <div style={{ flex: 1 }}>
                <label className="mono" style={label}>SEASON</label>
                <input value={season} onChange={(e) => setSeason(e.target.value)} inputMode="numeric" style={field} />
              </div>
            </div>

            {needsCookies && (
              <div>
                <label className="mono" style={label}>PRIVATE LEAGUE? PASTE COOKIES (OPTIONAL)</label>
                <input value={s2} onChange={(e) => setS2(e.target.value)} placeholder="espn_s2" spellCheck={false} autoCapitalize="none" autoCorrect="off" style={{ ...field, marginBottom: 8 }} />
                <input value={swid} onChange={(e) => setSwid(e.target.value)} placeholder="SWID  {…}" spellCheck={false} autoCapitalize="none" autoCorrect="off" style={field} />
                <div className="mono" style={{ fontSize: 9, color: 'var(--faint)', marginTop: 8, lineHeight: 1.5 }}>
                  Public leagues need no cookies. For a private league, copy <b>espn_s2</b> and <b>SWID</b> from your browser cookies on espn.com (DevTools → Application → Cookies). They’re sent once to read your league and never stored.
                </div>
              </div>
            )}

            <button type="button" onClick={() => setAddKdst((v) => !v)} disabled={busy} className="mono" title="Adds a real K and DST to any team missing one, so the kicker/defense metrics are playable." style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: 'transparent', border: 'none', padding: 0, cursor: busy ? 'default' : 'pointer', color: 'var(--dim)' }}>
              <span style={{ width: 30, height: 17, borderRadius: 999, background: addKdst ? 'var(--you)' : 'var(--bd)', position: 'relative', transition: 'background 120ms', flex: 'none' }}>
                <span style={{ position: 'absolute', top: 2, left: addKdst ? 15 : 2, width: 13, height: 13, borderRadius: '50%', background: 'var(--on-accent)', transition: 'left 120ms' }} />
              </span>
              <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.04em', color: addKdst ? 'var(--text)' : 'var(--dim)' }}>ADD K &amp; DST TO ROSTERS MISSING THEM</span>
            </button>

            <button onClick={submit} disabled={busy || !leagueId.trim()} className="mono" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--on-accent)', background: 'var(--you)', border: 'none', borderRadius: 6, padding: '12px 0', cursor: busy ? 'default' : 'pointer', opacity: busy || !leagueId.trim() ? 0.6 : 1 }}>
              {busy ? (note || 'Building…') : '▶ RUN MY SEASON'}
            </button>
            {err && <div className="mono" style={{ fontSize: 10.5, color: 'var(--opp)', lineHeight: 1.4 }}>{err}</div>}
          </div>
        </div>
      </main>
    </div>
  );
}
