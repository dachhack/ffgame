// ADD DRIP TO MY ESPN / FLEAFLICKER / MFL / YAHOO LEAGUE (0423, v0.613.0).
// Founder: "Let's do the same for the other league providers (ESPN, Yahoo,
// etc). Current season inputs only." The Sleeper card's shape, with one
// difference: no platform but Sleeper gives us a user id, so once the league
// is read you PICK YOUR TEAM from its list, and so does everyone who follows
// with the invite code. Three steps on one card: platform + league id → the
// teams → bring it in (and schedule every week the platform has published).
import { useState } from 'react';
import { useStore } from '../app/store';
import { IMPORT_PROVIDERS, normalizeProviderLeague, importMyProviderLeague, providerImportSeason, type ImportProvider } from '@drip/core/data/providerAdmin';
import type { NormalizedLeague } from '@drip/core/data/normalized';
import { yahooConfigured, yahooConnected } from '@drip/core/data/providers/yahooClient';
import { friendlyError } from '@drip/core/data/liveApi';
import { track, Ev } from '@drip/core/analytics';

const card: React.CSSProperties = { background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 8, padding: 18 };
const label: React.CSSProperties = { fontSize: 9, letterSpacing: '0.14em', color: 'var(--faint)', fontWeight: 700 };
const input: React.CSSProperties = { flex: 1, minWidth: 0, fontFamily: 'inherit', fontSize: 14, color: 'var(--text)', background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 5, padding: '10px 12px', outline: 'none' };
const btn: React.CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--on-accent)', background: 'var(--you)', border: 'none', borderRadius: 5, padding: '0 16px', cursor: 'pointer', whiteSpace: 'nowrap' };
const linkBtn: React.CSSProperties = { background: 'none', border: 'none', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--dim)', cursor: 'pointer' };

export function ProviderImport({ onDone, onBack, initial = 'espn' }: {
  onDone: (leagueId: string, name: string, inviteCode: string) => void;
  onBack: () => void;
  initial?: ImportProvider;
}) {
  const { navigate } = useStore();
  const season = providerImportSeason();
  const [provider, setProvider] = useState<ImportProvider>(initial);
  const [ref, setRef] = useState('');
  const [swid, setSwid] = useState('');
  const [s2, setS2] = useState('');
  const [norm, setNorm] = useState<NormalizedLeague | null>(null);
  const [mine, setMine] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ leagueId: string; name: string; code: string; seats: number; weeks: number } | null>(null);
  const meta = IMPORT_PROVIDERS.find((p) => p.id === provider)!;
  const yahooReady = provider !== 'yahoo' || (yahooConfigured() && yahooConnected());

  const pick = (p: ImportProvider) => { setProvider(p); setNorm(null); setMine(null); setErr(null); setNote(null); };
  const read = async () => {
    if (!ref.trim() || busy) return;
    setBusy('read'); setErr(null); setNorm(null); setMine(null);
    try {
      const n = await normalizeProviderLeague(provider, ref, season, provider === 'espn' ? { swid: swid.trim() || undefined, s2: s2.trim() || undefined } : undefined, setNote);
      if (!n.teams.length) { setErr('That league came back with no teams. Check the id — and for a private ESPN league, the two cookies.'); return; }
      setNorm(n);
    } catch (x) { setErr(friendlyError(x)); }
    finally { setBusy(null); setNote(null); }
  };
  const bring = async () => {
    if (!norm || mine == null || busy) return;
    setBusy('import'); setErr(null);
    try {
      const r = await importMyProviderLeague(provider, ref, season, norm, mine, setNote);
      if (!r.ok || !r.league_id) { setErr(friendlyError(r.error ?? 'could not bring that league in')); return; }
      track(Ev.leagueOpened, { live: true, imported: true, provider });
      setDone({ leagueId: r.league_id, name: r.name ?? norm.name, code: r.invite_code ?? '', seats: r.seats ?? norm.teams.length, weeks: r.weeks });
    } catch (x) { setErr(friendlyError(x)); }
    finally { setBusy(null); setNote(null); }
  };

  if (done) return (
    <div style={{ maxWidth: 520, margin: '0 auto' }}>
      <div style={{ ...card, borderLeft: '3px solid var(--you)' }}>
        <div className="grotesk" style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>{done.name} is on Drip.</div>
        <div style={{ fontSize: 12.5, color: 'var(--dim)', marginTop: 8, lineHeight: 1.55 }}>
          You’re its commissioner here, on the team you picked. {done.seats} teams and {done.weeks} weeks of schedule came over from {meta.name}. Everyone else joins with this invite code and picks their own team from the list.
        </div>
        <div className="mono" style={{ marginTop: 14, fontSize: 22, fontWeight: 800, letterSpacing: '0.18em', color: 'var(--you)', textAlign: 'center', padding: '12px 0', background: 'var(--bg)', border: '1px dashed var(--bd)', borderRadius: 6 }}>{done.code || '—'}</div>
        <div style={{ fontSize: 11, color: 'var(--faint)', marginTop: 8, lineHeight: 1.5 }}>
          Lineups and pairings are a snapshot of {meta.name} right now. Press <b>⟳ sync season</b> on the commissioner’s desk after lineups change on {meta.name} — it isn’t automatic for {meta.name} leagues yet. Pick Drip or Classic and set the rest from the desk.
        </div>
        <button onClick={() => onDone(done.leagueId, done.name, done.code)} className="mono" style={{ ...btn, width: '100%', padding: '12px 0', marginTop: 14 }}>OPEN THE COMMISSIONER’S DESK →</button>
      </div>
    </div>
  );

  return (
    <div style={{ maxWidth: 520, margin: '0 auto' }}>
      <div style={{ textAlign: 'center', marginBottom: 18 }}>
        <div className="grotesk" style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text)' }}>Add Drip to your {meta.name} league</div>
        <div style={{ fontSize: 12.5, color: 'var(--dim)', marginTop: 8, lineHeight: 1.5 }}>Your league keeps living on {meta.name} — rosters, waivers, trades. Drip reads it and runs the game on top. You become its commissioner here and pick your team; your league-mates join with a code and pick theirs. This season ({season}) only.</div>
      </div>
      <div style={card}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
          {IMPORT_PROVIDERS.map((p) => (
            <button key={p.id} onClick={() => pick(p.id)} className="mono" aria-pressed={p.id === provider}
              style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', padding: '6px 12px', borderRadius: 5, cursor: 'pointer',
                color: p.id === provider ? 'var(--you)' : 'var(--dim)', background: p.id === provider ? 'color-mix(in srgb, var(--you) 12%, var(--surface))' : 'var(--bg)', border: `1px solid ${p.id === provider ? 'var(--you)' : 'var(--bd)'}` }}>{p.name.toUpperCase()}</button>
          ))}
        </div>
        {!yahooReady ? (
          <div>
            <div style={{ fontSize: 12, color: 'var(--dim)', lineHeight: 1.5 }}>
              {yahooConfigured()
                ? <>Yahoo needs you signed in to Yahoo first. Sign in, then come back here through ＋ ADD A LEAGUE.</>
                : <>Yahoo isn’t connected on this site yet. Tell us the league and we’ll set it up by hand.</>}
            </div>
            {yahooConfigured() && <button onClick={() => navigate({ name: 'connect', provider: 'yahoo' })} className="mono" style={{ ...btn, padding: '10px 16px', marginTop: 12 }}>SIGN IN WITH YAHOO →</button>}
          </div>
        ) : (
          <>
            <label className="mono" style={label}>{meta.refLabel}</label>
            <div style={{ display: 'flex', gap: 8, marginTop: 7 }}>
              <input value={ref} autoFocus autoCapitalize="none" autoCorrect="off" spellCheck={false}
                onChange={(e) => { setRef(e.target.value); setErr(null); setNorm(null); setMine(null); }}
                onKeyDown={(e) => { if (e.key === 'Enter') read(); }}
                placeholder={meta.refHint} style={input} />
              <button onClick={read} disabled={!!busy || !ref.trim()} className="mono" style={{ ...btn, opacity: busy || !ref.trim() ? 0.6 : 1 }}>{busy === 'read' ? '…' : 'READ THE LEAGUE'}</button>
            </div>
            {provider === 'espn' && (
              <div style={{ marginTop: 10 }}>
                <div className="mono" style={{ fontSize: 9, color: 'var(--faint)', lineHeight: 1.5 }}>Private ESPN league? Paste your <b>SWID</b> and <b>espn_s2</b> cookies (public leagues need neither). They’re used once, in your browser, and not stored.</div>
                <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                  <input value={swid} onChange={(e) => setSwid(e.target.value)} placeholder="SWID {…}" spellCheck={false} style={{ ...input, fontSize: 12 }} />
                  <input value={s2} onChange={(e) => setS2(e.target.value)} placeholder="espn_s2" spellCheck={false} style={{ ...input, fontSize: 12 }} />
                </div>
              </div>
            )}
          </>
        )}
        {norm && (
          <div style={{ marginTop: 16 }}>
            <div className="grotesk" style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{norm.name}</div>
            <div className="mono" style={{ fontSize: 9.5, color: 'var(--faint)', letterSpacing: '0.06em', marginTop: 2 }}>{norm.teams.length}-TEAM · {norm.format.toUpperCase()} · {norm.weeks} WEEKS SCHEDULED</div>
            <div className="mono" style={{ ...label, marginTop: 12, marginBottom: 8 }}>WHICH TEAM IS YOURS?</div>
            <div style={{ display: 'grid', gap: 6 }}>
              {norm.teams.map((t) => {
                const on = mine === t.rosterId;
                return (
                  <button key={t.rosterId} onClick={() => { setMine(t.rosterId); setErr(null); }} disabled={!!busy}
                    style={{ textAlign: 'left', display: 'flex', alignItems: 'center', gap: 10, background: on ? 'color-mix(in srgb, var(--you) 10%, var(--bg))' : 'var(--bg)', border: `1px solid ${on ? 'var(--you)' : 'var(--bd)'}`, borderRadius: 6, padding: '9px 12px', cursor: 'pointer' }}>
                    <span className="mono" style={{ fontSize: 12, fontWeight: 700, color: on ? 'var(--you)' : 'var(--faint)', width: 14 }}>{on ? '●' : '○'}</span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span className="grotesk" style={{ display: 'block', fontSize: 13.5, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.teamName}</span>
                      {t.owner && <span className="mono" style={{ fontSize: 9, color: 'var(--faint)' }}>{t.owner}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
            <button onClick={bring} disabled={mine == null || !!busy} className="mono" style={{ ...btn, width: '100%', padding: '12px 0', marginTop: 12, opacity: mine == null || busy ? 0.6 : 1 }}>{busy === 'import' ? (note ?? '…') : 'BRING IT IN →'}</button>
          </div>
        )}
        {note && busy === 'read' && <div className="mono" style={{ fontSize: 10, color: 'var(--dim)', marginTop: 10 }}>⟳ {note}</div>}
        {err && <div className="mono" style={{ fontSize: 10.5, color: 'var(--opp)', marginTop: 10, lineHeight: 1.4 }}>{err}</div>}
        <div className="mono" style={{ fontSize: 9.5, color: 'var(--faint)', marginTop: 12, lineHeight: 1.5 }}>
          Already on Drip? Ask its commissioner for the invite code instead. Sleeper leagues have their own card.
        </div>
      </div>
      <div style={{ textAlign: 'center', marginTop: 16 }}><button onClick={onBack} className="mono" style={linkBtn}>← back</button></div>
    </div>
  );
}
