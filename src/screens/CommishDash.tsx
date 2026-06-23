import { useEffect, useState } from 'react';
import { commishOverview, type AdminLeague } from '../data/liveApi';
import { LeagueRow } from './AdminPage';

const card: React.CSSProperties = { background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 8, padding: 14 };
const h: React.CSSProperties = { fontSize: 10, letterSpacing: '0.12em', color: 'var(--dim)', fontWeight: 700, marginBottom: 10 };
const linkBtn: React.CSSProperties = { background: 'none', border: 'none', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--dim)', cursor: 'pointer' };

export function CommishDash({ onBack }: { onBack: () => void }) {
  const [leagues, setLeagues] = useState<AdminLeague[] | null>(null);
  const load = async () => { try { setLeagues(await commishOverview()); } catch { setLeagues([]); } };
  useEffect(() => { load(); }, []);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span className="grotesk" style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>⚑ My leagues</span>
        <button onClick={load} className="mono" style={linkBtn}>↻ refresh</button>
      </div>
      <div style={card}>
        <div style={h}>LEAGUES YOU RUN</div>
        {leagues === null ? <div className="mono" style={{ fontSize: 10.5, color: 'var(--faint)' }}>Loading…</div>
          : leagues.length === 0 ? <div className="mono" style={{ fontSize: 10.5, color: 'var(--faint)', lineHeight: 1.5 }}>None yet. Verify ownership via “I’m the commissioner,” and ask the admin to import the league if it isn’t listed.</div>
          : leagues.map((l) => <LeagueRow key={l.league_id} l={l} reload={load} admin={false} />)}
      </div>
      <div className="mono" style={{ fontSize: 9.5, color: 'var(--faint)', margin: '10px 4px', lineHeight: 1.5 }}>
        Share the invite link with your players, see who’s joined, sync each week’s matchups, and run the live windows — all for the leagues you commission.
      </div>
      <div style={{ textAlign: 'center', marginTop: 6 }}><button onClick={onBack} className="mono" style={linkBtn}>← back</button></div>
    </div>
  );
}
