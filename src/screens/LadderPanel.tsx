// RELEGATION (0502): the commissioner's LADDER tab and the members' ladder
// card. A ladder links leagues as tiers; the settings are chips with one ⓘ,
// and the whole ladder rolls over from here at the end of the season.
import { useEffect, useState } from 'react';
import {
  leagueLadderState, myLadderCandidates, createLeagueLadder, setLadderRules, setLadderTiers,
  deleteLeagueLadder, ladderRollover, type LadderState, type LadderMethod, type LadderRosterMode,
} from '@drip/core/data/liveApi';
import { LADDER_METHODS, LADDER_ROSTER_MODES, LADDER_INFO, ladderMethodLabel, ladderRosterLabel, tierMovesLine, lastMovesLine } from '@drip/core/data/ladder';
import { card, mono, btn, inp, subhead, errMsg, InfoChip, LabelInfo } from './adminUi';

type Cand = { league_id: string; name: string; season: string; teams: number; ladder_id: string | null };

const row: React.CSSProperties = { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' };

/** The commissioner's LADDER tab. */
export function LadderPanel({ leagueId, leagueName }: { leagueId: string; leagueName: string | null }) {
  const [st, setSt] = useState<LadderState | null>(null);
  const [cands, setCands] = useState<Cand[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  // the builder's draft: tiers top first, and the rules
  const [name, setName] = useState('');
  const [tiers, setTiers] = useState<string[]>([leagueId]);
  const [method, setMethod] = useState<LadderMethod>('standings');
  const [movers, setMovers] = useState(2);
  const [mode, setMode] = useState<LadderRosterMode>('seat');
  const [editTiers, setEditTiers] = useState(false);

  const load = async () => {
    const s = await leagueLadderState(leagueId);
    setSt(s);
    if (s.ladder) {
      setMethod(s.ladder.method); setMovers(s.ladder.movers); setMode(s.ladder.roster_mode);
      setTiers((s.tiers ?? []).map((t) => t.league_id));
    }
    myLadderCandidates().then((c) => setCands(Array.isArray(c) ? c : [])).catch(() => setCands([]));
  };
  useEffect(() => { load().catch((e) => setMsg(errMsg(e, 'load failed'))); /* eslint-disable-next-line */ }, [leagueId]);

  const run = async (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => {
    if (busy) return;
    setBusy(true); setMsg(null);
    try { const r = await fn(); setMsg(r.ok ? `✓ ${done}` : (r.error ?? 'that didn’t work')); if (r.ok) await load(); }
    catch (e) { setMsg(errMsg(e, 'failed')); }
    finally { setBusy(false); }
  };

  if (!st) return <div className="mono" style={{ ...mono, fontSize: 12, color: 'var(--faint)', marginTop: 12 }}>{msg ?? 'loading…'}</div>;
  const lad = st.ladder;
  // A season that already rolled over left its ladder behind with it: the
  // ladder lives on in next season's leagues.
  if (!lad && cands && !cands.some((c) => c.league_id === leagueId)) {
    return <div style={card}><LabelInfo label="🪜 LADDER" title="Relegation ladder" info={LADDER_INFO} />
      <div className="mono" style={{ ...mono, fontSize: 12, color: 'var(--faint)', marginTop: 6 }}>season over — ladders live in next season’s league</div></div>;
  }
  const list = cands ?? [];
  const season = list.find((c) => c.league_id === leagueId)?.season ?? st.tiers?.find((t) => t.mine)?.season ?? null;
  const nameOf = (id: string) => list.find((c) => c.league_id === id)?.name ?? st.tiers?.find((t) => t.league_id === id)?.name ?? 'a league';
  const addable = list.filter((c) => !tiers.includes(c.league_id) && (!c.ladder_id || c.ladder_id === lad?.id) && (!season || c.season === season));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d; if (j < 0 || j >= tiers.length) return;
    const n = [...tiers]; [n[i], n[j]] = [n[j], n[i]]; setTiers(n);
  };
  const canEdit = !lad || lad.can_edit;

  const tierEditor = (
    <div style={{ marginTop: 8 }}>
      {tiers.map((id, i) => (
        <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', background: 'var(--bg)', borderRadius: 5, marginTop: 2 }}>
          <span className="mono" style={{ ...mono, fontSize: 11, fontWeight: 700, color: 'var(--faint)', width: 52 }}>TIER {i + 1}</span>
          <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nameOf(id)}</span>
          <button onClick={() => move(i, -1)} disabled={i === 0} className="mono" style={{ ...btn(), padding: '3px 8px', opacity: i === 0 ? 0.35 : 1 }}>▲</button>
          <button onClick={() => move(i, 1)} disabled={i === tiers.length - 1} className="mono" style={{ ...btn(), padding: '3px 8px', opacity: i === tiers.length - 1 ? 0.35 : 1 }}>▼</button>
          {id !== leagueId && <button onClick={() => setTiers(tiers.filter((x) => x !== id))} className="mono" style={{ ...btn(), padding: '3px 8px', color: 'var(--opp)' }}>✕</button>}
        </div>
      ))}
      {addable.length > 0 && (
        <select value="" onChange={(e) => { if (e.target.value) setTiers([...tiers, e.target.value]); }}
          className="mono" style={{ ...mono, marginTop: 6, fontSize: 12, color: 'var(--text)', background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 4, padding: '5px 6px' }}>
          <option value="">+ add a league…</option>
          {addable.map((c) => <option key={c.league_id} value={c.league_id}>{c.name} · {c.teams} teams</option>)}
        </select>
      )}
    </div>
  );

  const rules = (onPick: (r: { method?: LadderMethod; movers?: number; rosterMode?: LadderRosterMode }) => void) => (
    <>
      <div style={{ ...subhead, marginTop: 14 }}>METHOD</div>
      <div style={row}>
        {LADDER_METHODS.map((m) => (
          <button key={m.id} disabled={!canEdit || busy} onClick={() => onPick({ method: m.id })} className="mono" style={btn(method === m.id)} title={m.info}>{m.label}</button>
        ))}
      </div>
      <div style={{ ...subhead, marginTop: 14 }}>TEAMS UP &amp; DOWN</div>
      <div style={row}>
        {[1, 2, 3, 4, 5, 6].map((n) => (
          <button key={n} disabled={!canEdit || busy} onClick={() => onPick({ movers: n })} className="mono" style={btn(movers === n)}>{n}</button>
        ))}
      </div>
      <div style={{ ...subhead, marginTop: 14 }}>ROSTERS</div>
      <div style={row}>
        {LADDER_ROSTER_MODES.map((m) => (
          <button key={m.id} disabled={!canEdit || busy} onClick={() => onPick({ rosterMode: m.id })} className="mono" style={btn(mode === m.id)} title={m.info}>{m.label}</button>
        ))}
      </div>
    </>
  );

  return (
    <div style={card}>
      <LabelInfo label="🪜 LADDER" title="Relegation ladder" info={LADDER_INFO} />
      {msg && <div className="mono" style={{ ...mono, fontSize: 12, color: msg.startsWith('✓') ? 'var(--you)' : 'var(--opp)', marginTop: 6 }}>{msg}</div>}

      {!lad ? (
        <>
          <div style={{ ...subhead, marginTop: 10 }}>NAME</div>
          <input value={name} maxLength={60} placeholder={`${leagueName ?? 'League'} Ladder`} onChange={(e) => setName(e.target.value)} style={{ ...inp, width: '100%', maxWidth: 360 }} />
          <div style={{ ...subhead, marginTop: 14 }}>TIERS</div>
          {tierEditor}
          {rules((r) => { if (r.method) setMethod(r.method); if (r.movers) setMovers(r.movers); if (r.rosterMode) setMode(r.rosterMode); })}
          <button disabled={busy || tiers.length < 2} className="mono" style={{ ...btn(true), marginTop: 16, opacity: tiers.length < 2 ? 0.4 : 1 }}
            onClick={() => void run(() => createLeagueLadder(name.trim() || `${leagueName ?? 'League'} Ladder`, tiers, method, movers, mode), 'ladder built')}>
            BUILD THE LADDER
          </button>
        </>
      ) : (
        <>
          <div className="grotesk" style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', marginTop: 8 }}>{lad.name}</div>
          <div className="mono" style={{ ...mono, fontSize: 11, color: 'var(--dim)', marginTop: 2 }}>
            {ladderMethodLabel(lad.method)} · {lad.movers} up &amp; down · {ladderRosterLabel(lad.roster_mode)}
          </div>
          <div style={{ ...subhead, marginTop: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
            TIERS
            {canEdit && <button onClick={() => setEditTiers(!editTiers)} className="mono" style={{ ...btn(editTiers), padding: '2px 8px', fontSize: 11 }}>{editTiers ? 'close' : 'edit'}</button>}
          </div>
          {editTiers ? (
            <>
              {tierEditor}
              <button disabled={busy} className="mono" style={{ ...btn(true), marginTop: 8 }}
                onClick={() => void run(() => setLadderTiers(lad.id, tiers), 'tiers saved').then(() => setEditTiers(false))}>SAVE TIERS</button>
            </>
          ) : (st.tiers ?? []).map((t) => (
            <div key={t.league_id} style={{ padding: '6px 8px', background: t.mine ? 'var(--surface2, var(--bg))' : 'var(--bg)', borderRadius: 5, marginTop: 2 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                <span className="mono" style={{ ...mono, fontSize: 11, fontWeight: 700, color: 'var(--faint)', width: 52 }}>TIER {t.tier}</span>
                <span style={{ fontSize: 13.5, color: t.mine ? 'var(--you)' : 'var(--text)', fontWeight: t.mine ? 700 : 400 }}>{t.name}</span>
              </div>
              {tierMovesLine(t) && <div className="mono" style={{ ...mono, fontSize: 11, color: 'var(--dim)', marginTop: 2, marginLeft: 60 }}>{tierMovesLine(t)}</div>}
            </div>
          ))}
          {rules((r) => {
            if (r.method) setMethod(r.method); if (r.movers) setMovers(r.movers); if (r.rosterMode) setMode(r.rosterMode);
            void run(() => setLadderRules(lad.id, r), 'saved');
          })}
          {lastMovesLine(st) && <div className="mono" style={{ ...mono, fontSize: 11, color: 'var(--faint)', marginTop: 12 }}>{lastMovesLine(st)}</div>}
          {canEdit && (
            <div style={{ ...row, marginTop: 16 }}>
              <button disabled={busy} className="mono" style={btn(true)} onClick={() => {
                if (!window.confirm(`Roll the whole ${lad.name} ladder into next season?\n\nEvery tier rolls over together, then ${lad.movers} team${lad.movers === 1 ? '' : 's'} per tier move up and down by ${ladderMethodLabel(lad.method)} (${ladderRosterLabel(lad.roster_mode)}). If any tier can’t roll yet, nothing changes.`)) return;
                void run(async () => {
                  const r = await ladderRollover(lad.id);
                  return r.ok ? { ok: true } : r;
                }, 'the ladder rolled into next season — the tiers below now point at the new leagues');
              }}>⤴ ROLL THE LADDER OVER</button>
              <InfoChip title="Rolling the ladder over" info="Opens after the season ends. Every tier moves to next season at once — the same as NEXT SEASON for each league — and then the movers swap places. A league in a ladder can only roll over from here." />
              <span style={{ flex: 1 }} />
              <button disabled={busy} className="mono" style={{ ...btn(), color: 'var(--opp)' }} onClick={() => {
                if (!window.confirm(`Take down the ${lad.name} ladder? The leagues stay as they are; they just stop being linked.`)) return;
                void run(() => deleteLeagueLadder(lad.id), 'ladder taken down');
              }}>✕ TAKE DOWN</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** The members' card: which tier this is, and who's moving if it ended now.
 *  Renders nothing for a league outside any ladder. */
export function LadderCard({ leagueId }: { leagueId: string }) {
  const [st, setSt] = useState<LadderState | null>(null);
  useEffect(() => { leagueLadderState(leagueId).then(setSt).catch(() => {}); }, [leagueId]);
  const lad = st?.ladder;
  if (!lad || !st?.tiers) return null;
  return (
    <div style={{ marginTop: 22 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <div className="grotesk" style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)' }}>🪜 {lad.name}</div>
        <span className="mono" style={{ ...mono, fontSize: 11, color: 'var(--dim)' }}>tier {st.tier} of {st.tiers.length}</span>
        <InfoChip title={lad.name} info={`${ladderMethodLabel(lad.method)} · ${lad.movers} up & down · ${ladderRosterLabel(lad.roster_mode)}\n\n${LADDER_INFO}`} />
      </div>
      {st.tiers.map((t) => (
        <div key={t.league_id} style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '5px 0', borderTop: '1px solid var(--bd)' }}>
          <span className="mono" style={{ ...mono, fontSize: 10.5, fontWeight: 700, color: 'var(--faint)', width: 46 }}>TIER {t.tier}</span>
          <span style={{ fontSize: 12.5, color: t.mine ? 'var(--you)' : 'var(--text)', fontWeight: t.mine ? 700 : 400, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
          <span className="mono" style={{ ...mono, fontSize: 10.5, color: 'var(--dim)', marginLeft: 'auto', textAlign: 'right' }}>{tierMovesLine(t)}</span>
        </div>
      ))}
      {lastMovesLine(st) && <div className="mono" style={{ ...mono, fontSize: 10.5, color: 'var(--faint)', marginTop: 4 }}>{lastMovesLine(st)}</div>}
    </div>
  );
}
