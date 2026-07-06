import { useEffect, useState } from 'react';
import { commishOverview, type AdminLeague } from '../data/liveApi';
import { LeagueRow } from './AdminPage';
import { card, linkBtn, mono, Muted, errMsg } from './adminUi';

// Commissioner dashboard — one tabbed management card (LeagueRow) per league you
// run. Opened from a league card's "manage" (focusId → just that league) or as
// the landing screen for commish-only accounts (all your leagues).
export function CommishDash({ onBack, focusId }: { onBack: () => void; focusId?: string | null }) {
  const [leagues, setLeagues] = useState<AdminLeague[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Keep already-loaded leagues on a failed refresh; surface the real error.
  const load = async () => {
    try { setLeagues(await commishOverview()); setErr(null); }
    catch (e) { setErr(errMsg(e, 'Load failed.')); setLeagues((cur) => cur ?? []); }
  };
  useEffect(() => { load(); }, []);

  const shown = focusId && leagues ? leagues.filter((l) => l.league_id === focusId) : leagues;
  const title = focusId ? (shown?.[0]?.name ?? 'League') : '⚑ My leagues';

  return (
    <div className="mgmt">
      <button onClick={onBack} className="mono" style={{ ...linkBtn, color: 'var(--you)', marginBottom: 10 }}>← all leagues</button>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div className="grotesk" style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>
          <div className="mono" style={{ ...mono, fontSize: 9.5, color: 'var(--faint)', marginTop: 2 }}>
            Commissioner tools — invite players, seed coin, sync the season, run the live weeks.
          </div>
        </div>
        <button onClick={load} className="mono" style={{ ...linkBtn, flexShrink: 0 }}>↻ refresh</button>
      </div>

      {err && <div className="mono" style={{ ...mono, fontSize: 10.5, color: 'var(--opp)', marginBottom: 10, lineHeight: 1.5, wordBreak: 'break-word' }}>⚠ {err}</div>}
      {shown === null ? <div style={card}><Muted text="Loading…" /></div>
        : shown.length === 0 ? (
          <div style={card}>
            <div className="mono" style={{ ...mono, fontSize: 10.5, color: 'var(--faint)', lineHeight: 1.5 }}>None yet. Verify ownership via “I’m the commissioner,” and ask the admin to import the league if it isn’t listed.</div>
          </div>
        )
        : shown.map((l, i) => (
          // With several leagues, cards collapse to just their header (first one
          // starts open) so the list stays scannable; a lone/focused league is
          // always expanded.
          <LeagueRow key={l.league_id} l={l} reload={load} admin={false} defaultTab="members"
            collapsible={shown.length > 1} defaultOpen={i === 0} />
        ))}

      <div className="mono" style={{ fontSize: 9.5, color: 'var(--faint)', margin: '10px 4px', lineHeight: 1.5 }}>
        Share the invite link with your players, see who’s joined, sync each week’s matchups, and run the live windows — all for the leagues you commission.
      </div>
      <div style={{ textAlign: 'center', marginTop: 6 }}><button onClick={onBack} className="mono" style={linkBtn}>← all leagues</button></div>
    </div>
  );
}
