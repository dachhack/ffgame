// 💍 SHOTGUN WEDDING on the web (v0.653.0) — docs/shotgun-wedding.md. The
// app's ShotgunWeddingCard (apps/mobile/src/ui) is its twin; the words come
// from core (data/shotgunWedding) so the two never disagree.
//
// Renders nothing unless the league has the mode on and a week with
// weddings. Your own wedding comes first and carries the controls: CALL IT
// OFF (the winner only), PROPOSE NEW VOWS (either team: one to three players
// each way), and SAY YES to the other side's vows. Everyone else's are one
// line each, so the league can watch.
import { useEffect, useState } from 'react';
import {
  shotgunState, shotgunDecline, shotgunCounter, shotgunAcceptCounter, friendlyError,
} from '@drip/core/data/liveApi';
import {
  weddingStatusLine, weddingCounterLine, weddingSends, weddingPlayerTag, type Wedding, type WeddingPlayer,
} from '@drip/core/data/shotgunWedding';

const card: React.CSSProperties = { background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 8, padding: 14, marginBottom: 12 };
const hdr: React.CSSProperties = { fontSize: 10, letterSpacing: '0.12em', color: 'var(--dim)', fontWeight: 700 };
const btn = (tone: 'you' | 'opp' | 'plain', busy: boolean): React.CSSProperties => ({
  fontSize: 10, fontWeight: 700, padding: '6px 11px', borderRadius: 999, cursor: busy ? 'default' : 'pointer',
  opacity: busy ? 0.6 : 1, letterSpacing: '0.04em',
  border: `1px solid ${tone === 'you' ? 'var(--you)' : tone === 'opp' ? 'var(--opp)' : 'var(--bd)'}`,
  color: tone === 'you' ? 'var(--on-accent)' : tone === 'opp' ? 'var(--opp)' : 'var(--text)',
  background: tone === 'you' ? 'var(--you)' : 'var(--bg)',
});
const chip = (on: boolean): React.CSSProperties => ({
  fontSize: 10, padding: '4px 9px', borderRadius: 999, cursor: 'pointer',
  border: `1px solid ${on ? 'var(--you)' : 'var(--bd)'}`, color: on ? 'var(--you)' : 'var(--dim)',
  background: on ? 'color-mix(in srgb, var(--you) 10%, var(--surface))' : 'var(--surface)',
});

export function ShotgunWeddingCard({ leagueId, onChanged }: { leagueId: string; onChanged?: () => void }) {
  const [ws, setWs] = useState<Wedding[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [composing, setComposing] = useState<string | null>(null);
  const [pickH, setPickH] = useState<string[]>([]);
  const [pickA, setPickA] = useState<string[]>([]);

  const load = () => shotgunState(leagueId)
    .then((r) => setWs(r.ok && r.on !== false ? (r.weddings ?? []) : []))
    .catch(() => setWs([]));
  useEffect(() => {
    void load();
    const t = window.setInterval(() => { if (!document.hidden) void load(); }, 30_000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId]);

  const act = async (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => {
    if (busy) return;
    setBusy(true); setNote(null);
    try {
      const r = await fn();
      if (r.ok) { setNote(done); setComposing(null); await load(); onChanged?.(); }
      else setNote(friendlyError(r.error ?? 'that didn’t work'));
    } catch (x) { setNote(friendlyError(x)); }
    finally { setBusy(false); }
  };

  if (!ws?.length) return null;
  const toggle = (list: string[], set: (v: string[]) => void, slug: string) =>
    set(list.includes(slug) ? list.filter((s) => s !== slug) : list.length >= 3 ? list : [...list, slug]);

  return (
    <div style={card}>
      <div className="mono" style={hdr}>💍 SHOTGUN WEDDING · WEEK {ws[0].week}</div>
      {!!note && <div className="mono" style={{ fontSize: 10.5, marginTop: 8, color: note.startsWith('✓') ? 'var(--you)' : 'var(--opp)' }}>{note}</div>}
      {ws.map((w) => {
        const mine = w.my_seat != null;
        const iAmHome = w.my_seat === w.home.roster;
        const sendLine = (team: string, gives: WeddingPlayer[]) => weddingSends(team, gives);
        const counter = weddingCounterLine(w);
        if (!mine) {
          return (
            <div key={w.id} className="mono" style={{ fontSize: 10.5, color: 'var(--dim)', lineHeight: 1.5, marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--bd)' }}>
              <b style={{ color: 'var(--text)' }}>{w.home.team} ⇄ {w.away.team}</b> · {sendLine(w.home.team, w.home.gives)}; {sendLine(w.away.team, w.away.gives)}.
              <div style={{ color: 'var(--faint)' }}>{weddingStatusLine(w)}</div>
            </div>
          );
        }
        const rosterMine = iAmHome ? w.rosters?.home : w.rosters?.away;
        const rosterTheirs = iAmHome ? w.rosters?.away : w.rosters?.home;
        const myPick = iAmHome ? pickH : pickA; const setMy = iAmHome ? setPickH : setPickA;
        const theirPick = iAmHome ? pickA : pickH; const setTheir = iAmHome ? setPickA : setPickH;
        return (
          <div key={w.id} style={{ marginTop: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', lineHeight: 1.45 }}>
              {sendLine(w.home.team, w.home.gives)}
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', lineHeight: 1.45 }}>
              {sendLine(w.away.team, w.away.gives)}
            </div>
            <div className="mono" style={{ fontSize: 10.5, color: 'var(--dim)', marginTop: 6, lineHeight: 1.5 }}>{weddingStatusLine(w)}</div>
            {w.status === 'pending' && (
              <div className="mono" style={{ fontSize: 9.5, color: 'var(--faint)', marginTop: 3 }}>
                🔒 These four can’t be dropped, traded or moved to IR until it’s settled.
              </div>
            )}
            {counter && w.status === 'pending' && (
              <div className="mono" style={{ fontSize: 10.5, color: 'var(--warn)', marginTop: 8, lineHeight: 1.5 }}>{counter}</div>
            )}
            {w.status === 'pending' && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                {w.can_accept && (
                  <button className="mono" disabled={busy} style={btn('you', busy)}
                    onClick={() => void act(() => shotgunAcceptCounter(w.id), '✓ married on your own vows')}>SAY YES TO THE NEW VOWS</button>
                )}
                {w.can_counter && (
                  <button className="mono" disabled={busy} style={btn('plain', busy)}
                    onClick={() => {
                      if (composing === w.id) { setComposing(null); return; }
                      setComposing(w.id); setNote(null);
                      setPickH(w.home.gives.map((p) => p.slug)); setPickA(w.away.gives.map((p) => p.slug));
                    }}>{composing === w.id ? 'CLOSE' : 'PROPOSE NEW VOWS'}</button>
                )}
                {w.can_decline && (
                  <button className="mono" disabled={busy} style={btn('opp', busy)}
                    onClick={() => { if (window.confirm('Call off the wedding? Everyone keeps their players.')) void act(() => shotgunDecline(w.id), '✓ called off'); }}>
                    CALL IT OFF
                  </button>
                )}
              </div>
            )}
            {composing === w.id && rosterMine && rosterTheirs && (
              <div style={{ marginTop: 10, padding: 10, border: '1px dashed var(--bd)', borderRadius: 8 }}>
                <div className="mono" style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--faint)' }}>YOU SEND (1–3)</div>
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 5 }}>
                  {rosterMine.map((p) => (
                    <button key={p.slug} className="mono" style={chip(myPick.includes(p.slug))} onClick={() => toggle(myPick, setMy, p.slug)}>{weddingPlayerTag(p)}</button>
                  ))}
                </div>
                <div className="mono" style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--faint)', marginTop: 10 }}>YOU GET (1–3)</div>
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 5 }}>
                  {rosterTheirs.map((p) => (
                    <button key={p.slug} className="mono" style={chip(theirPick.includes(p.slug))} onClick={() => toggle(theirPick, setTheir, p.slug)}>{weddingPlayerTag(p)}</button>
                  ))}
                </div>
                <button className="mono" disabled={busy || !pickH.length || !pickA.length} style={{ ...btn('you', busy), marginTop: 10 }}
                  onClick={() => void act(() => shotgunCounter(w.id, pickH, pickA), '✓ new vows sent — they say yes, or the original goes through')}>
                  SEND NEW VOWS
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
