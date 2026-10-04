// ADD DRIP TO MY SLEEPER LEAGUE (0422, v0.612.0). Founder: "Any account can …
// add drip to an existing league." Until now a Sleeper league reached Drip
// only through the admin console: the founder imported it, emailed the
// commissioner a code, and the commissioner redeemed it. This is that path
// for the member themself, three steps on one card: your Sleeper username →
// the leagues you're in this season → bring one in. The database checks
// you're really in it and makes you its Drip commissioner; the invite code it
// hands back is what the rest of your league joins with.
import { useEffect, useState } from 'react';
import { myLeaguesOnSleeper, importMyLeague, importSeason } from '@drip/core/data/sleeperAdmin';
import { sleeperAvatarUrl, type SleeperLeague, type SleeperUser } from '@drip/core/data/sleeper';
import { friendlyError, myLinkedSleeper } from '@drip/core/data/liveApi';
import { track, Ev } from '@drip/core/analytics';

const card: React.CSSProperties = { background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 8, padding: 18 };
const label: React.CSSProperties = { fontSize: 9, letterSpacing: '0.14em', color: 'var(--faint)', fontWeight: 700 };
const input: React.CSSProperties = { flex: 1, minWidth: 0, fontFamily: 'inherit', fontSize: 14, color: 'var(--text)', background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 5, padding: '10px 12px', outline: 'none' };
const btn: React.CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--on-accent)', background: 'var(--you)', border: 'none', borderRadius: 5, padding: '0 16px', cursor: 'pointer', whiteSpace: 'nowrap' };
const linkBtn: React.CSSProperties = { background: 'none', border: 'none', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--dim)', cursor: 'pointer' };

export function SleeperImport({ userId, onDone, onBack }: {
  userId: string;
  /** The league is in; open its commissioner desk. */
  onDone: (leagueId: string, name: string, inviteCode: string) => void;
  onBack: () => void;
}) {
  const [username, setUsername] = useState('');
  const [me, setMe] = useState<SleeperUser | null>(null);
  const [leagues, setLeagues] = useState<SleeperLeague[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // 'find' | a league id
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ leagueId: string; name: string; code: string; seats: number } | null>(null);
  const season = importSeason();

  // A username linked earlier (an invite redeemed, a league already brought
  // in) is the one you mean; it pre-fills, it doesn't lock.
  useEffect(() => {
    let dead = false;
    myLinkedSleeper(userId).then((l) => { if (!dead && l?.username) setUsername((u) => u || l.username); }).catch(() => {});
    return () => { dead = true; };
  }, [userId]);

  const find = async () => {
    const u = username.trim().replace(/^@/, '');
    if (!u || busy) return;
    setBusy('find'); setErr(null); setLeagues(null); setMe(null);
    try {
      const r = await myLeaguesOnSleeper(u, season);
      if (!r) { setErr(`No Sleeper account called “${u}”. It’s the username, not the display name.`); return; }
      setMe(r.me); setLeagues(r.leagues);
      if (!r.leagues.length) setErr(`${r.me.displayName} isn’t in any ${season} NFL league on Sleeper.`);
    } catch (x) { setErr(friendlyError(x)); }
    finally { setBusy(null); }
  };
  const bring = async (lg: SleeperLeague) => {
    if (!me || busy) return;
    setBusy(lg.leagueId); setErr(null);
    try {
      const r = await importMyLeague(lg.leagueId, me, season);
      if (!r.ok || !r.league_id) { setErr(friendlyError(r.error ?? 'could not bring that league in')); return; }
      track(Ev.leagueOpened, { live: true, imported: true });
      setDone({ leagueId: r.league_id, name: r.name ?? lg.name, code: r.invite_code ?? '', seats: r.seats ?? lg.totalRosters });
    } catch (x) { setErr(friendlyError(x)); }
    finally { setBusy(null); }
  };

  if (done) return (
    <div style={{ maxWidth: 520, margin: '0 auto' }}>
      <div style={{ ...card, borderLeft: '3px solid var(--you)' }}>
        <div className="grotesk" style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>{done.name} is on Drip.</div>
        <div style={{ fontSize: 12.5, color: 'var(--dim)', marginTop: 8, lineHeight: 1.55 }}>
          You’re its commissioner here. {done.seats} seats came over from Sleeper; yours is linked. Everyone else joins with this invite code — they type their Sleeper username and land on their own team.
        </div>
        <div className="mono" style={{ marginTop: 14, fontSize: 22, fontWeight: 800, letterSpacing: '0.18em', color: 'var(--you)', textAlign: 'center', padding: '12px 0', background: 'var(--bg)', border: '1px dashed var(--bd)', borderRadius: 6 }}>{done.code || '—'}</div>
        <div style={{ fontSize: 11, color: 'var(--faint)', marginTop: 8, lineHeight: 1.5 }}>
          The schedule and rosters mirror from Sleeper on their own from here (within the hour; sooner on game days). Pick Drip or Classic and set the rest from the commissioner’s desk.
        </div>
        <button onClick={() => onDone(done.leagueId, done.name, done.code)} className="mono" style={{ ...btn, width: '100%', padding: '12px 0', marginTop: 14 }}>OPEN THE COMMISSIONER’S DESK →</button>
      </div>
    </div>
  );

  return (
    <div style={{ maxWidth: 520, margin: '0 auto' }}>
      <div style={{ textAlign: 'center', marginBottom: 18 }}>
        <div className="grotesk" style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text)' }}>Add Drip to your Sleeper league</div>
        <div style={{ fontSize: 12.5, color: 'var(--dim)', marginTop: 8, lineHeight: 1.5 }}>Your league keeps living on Sleeper — rosters, waivers, trades. Drip reads it and runs the game on top. You become the league’s commissioner here; your league-mates join with a code.</div>
      </div>
      <div style={card}>
        <label className="mono" style={label}>YOUR SLEEPER USERNAME</label>
        <div style={{ display: 'flex', gap: 8, marginTop: 7 }}>
          <input value={username} autoFocus autoCapitalize="none" autoCorrect="off" spellCheck={false}
            onChange={(e) => { setUsername(e.target.value); setErr(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') find(); }}
            placeholder="the name you log in to Sleeper with" style={input} />
          <button onClick={find} disabled={!!busy || !username.trim()} className="mono" style={{ ...btn, opacity: busy || !username.trim() ? 0.6 : 1 }}>{busy === 'find' ? '…' : 'FIND MY LEAGUES'}</button>
        </div>
        {me && leagues && leagues.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div className="mono" style={{ ...label, marginBottom: 8 }}>{me.displayName.toUpperCase()}’S {season} LEAGUES — PICK ONE</div>
            <div style={{ display: 'grid', gap: 8 }}>
              {leagues.map((lg) => {
                const la = sleeperAvatarUrl(lg.avatar);
                const on = busy === lg.leagueId;
                return (
                  <button key={lg.leagueId} onClick={() => bring(lg)} disabled={!!busy}
                    style={{ textAlign: 'left', display: 'flex', alignItems: 'center', gap: 12, background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 6, padding: 12, cursor: 'pointer', opacity: busy && !on ? 0.6 : 1 }}>
                    {la
                      ? <img src={la} alt="" width={36} height={36} style={{ borderRadius: 7, flex: 'none' }} />
                      : <span className="grotesk" style={{ width: 36, height: 36, borderRadius: 7, background: 'var(--surface)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: 'var(--you)', flex: 'none' }}>{lg.name.slice(0, 1).toUpperCase()}</span>}
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="grotesk" style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lg.name}</div>
                      <div className="mono" style={{ fontSize: 9.5, color: 'var(--faint)', letterSpacing: '0.06em', marginTop: 2 }}>{lg.totalRosters}-TEAM · {lg.format.toUpperCase()} · {lg.scoring.toUpperCase()} · {lg.starters} STARTERS</div>
                    </div>
                    <span className="mono" style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--you)', flex: 'none' }}>{on ? '…' : 'BRING IT IN →'}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {err && <div className="mono" style={{ fontSize: 10.5, color: 'var(--opp)', marginTop: 10, lineHeight: 1.4 }}>{err}</div>}
        <div className="mono" style={{ fontSize: 9.5, color: 'var(--faint)', marginTop: 12, lineHeight: 1.5 }}>
          Only leagues you’re a manager in, and only this season’s. Already on Drip? Ask its commissioner for the invite code instead.
        </div>
      </div>
      <div style={{ textAlign: 'center', marginTop: 16 }}><button onClick={onBack} className="mono" style={linkBtn}>← back</button></div>
    </div>
  );
}
