// 💍 SHOTGUN WEDDING on the web (v0.653.0) — docs/shotgun-wedding.md. The
// app's ShotgunWeddingCard (apps/mobile/src/ui) is its twin; the words come
// from core (data/shotgunWedding) so the two never disagree.
//
// Renders nothing unless the league has the mode on and a week with
// weddings. Your own wedding comes first and carries the controls: CALL IT
// OFF (whoever holds the veto), PROPOSE NEW VOWS (either team: one to three
// players each way), and SAY YES to the other side's vows. Everyone else's
// are a smaller box each, so the league can watch, except for the commissioner
// (0456), who sees every pending wedding in full with ✎ REWRITE (change the
// trade outright) and CALL OFF, whatever the veto rule.
import { useEffect, useState } from 'react';
import {
  shotgunState, shotgunDecline, shotgunCounter, shotgunAcceptCounter, shotgunCommishEdit, shotgunCommishDecline, friendlyError,
} from '@drip/core/data/liveApi';
import {
  weddingStatusShort, weddingPlayerTag, type Wedding, type WeddingPlayer, type WeddingSide,
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

// THE TRADE BOX (v0.656.4, founder: "get rid of the walls of text"): the two
// sides side by side, a player to a row, instead of "X sends …" sentences.
function Side({ side, gives, you, get, small }: { side: WeddingSide; gives: WeddingPlayer[]; you: boolean; get: boolean; small?: boolean }) {
  return (
    <div style={{ flex: '1 1 0', minWidth: 0, padding: small ? '7px 9px' : '9px 11px', borderRadius: 7,
      background: you ? 'color-mix(in srgb, var(--you) 8%, var(--bg))' : 'var(--bg)', border: `1px solid ${you ? 'color-mix(in srgb, var(--you) 40%, var(--bd))' : 'var(--bd)'}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, alignItems: 'baseline' }}>
        <span style={{ fontSize: small ? 11.5 : 12.5, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{side.team}</span>
        {side.score != null && <span className="mono" style={{ fontSize: 10, color: 'var(--faint)', flex: 'none' }}>{side.score}</span>}
      </div>
      <div className="mono" style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.1em', color: you ? 'var(--you)' : 'var(--faint)', marginTop: 2 }}>{you ? 'YOU SEND' : get ? 'YOU GET' : 'SENDS'}</div>
      {gives.length ? gives.map((p) => (
        <div key={p.slug} style={{ display: 'flex', gap: 6, alignItems: 'baseline', marginTop: 4 }}>
          {p.pos && <span className="mono" style={{ fontSize: 9, fontWeight: 700, color: 'var(--dim)', width: 22, flex: 'none' }}>{p.pos}</span>}
          <span style={{ fontSize: small ? 11.5 : 12.5, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
        </div>
      )) : <div style={{ fontSize: 11.5, color: 'var(--faint)', marginTop: 4 }}>Nobody</div>}
    </div>
  );
}
function TradeBox({ w, home, away, small }: { w: Wedding; home: WeddingPlayer[]; away: WeddingPlayer[]; small?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'stretch', marginTop: small ? 6 : 10 }}>
      <Side side={w.home} gives={home} you={w.my_seat === w.home.roster} get={w.my_seat === w.away.roster} small={small} />
      <div style={{ alignSelf: 'center', color: 'var(--faint)', fontSize: 14, flex: 'none' }}>⇄</div>
      <Side side={w.away} gives={away} you={w.my_seat === w.away.roster} get={w.my_seat === w.home.roster} small={small} />
    </div>
  );
}

export function ShotgunWeddingCard({ leagueId, onChanged }: { leagueId: string; onChanged?: () => void }) {
  const [ws, setWs] = useState<Wedding[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  /** Which wedding's composer is open, and whose: the team's new vows, or the commissioner's rewrite. */
  const [composing, setComposing] = useState<{ id: string; mode: 'vows' | 'commish' } | null>(null);
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
        const boss = w.can_commish === true;
        const counterFrom = w.counter ? (w.counter.from === w.home.roster ? w.home.team : w.counter.from === w.away.roster ? w.away.team : 'one side') : null;
        if (!mine && !boss) {
          return (
            <div key={w.id} style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--bd)' }}>
              <TradeBox w={w} home={w.home.gives} away={w.away.gives} small />
              <div className="mono" style={{ fontSize: 10, color: 'var(--faint)', marginTop: 5 }}>{weddingStatusShort(w)}</div>
            </div>
          );
        }
        const iAmHome = w.my_seat === w.home.roster;
        const open = composing?.id === w.id ? composing.mode : null;
        // The composer's two rows: "you send / you get" for a team, the two
        // teams by name for the commissioner.
        const rows = open === 'commish' || !mine
          ? [{ label: `${w.home.team.toUpperCase()} SENDS (1–3)`, list: w.rosters?.home, pick: pickH, set: setPickH },
             { label: `${w.away.team.toUpperCase()} SENDS (1–3)`, list: w.rosters?.away, pick: pickA, set: setPickA }]
          : [{ label: 'YOU SEND (1–3)', list: iAmHome ? w.rosters?.home : w.rosters?.away, pick: iAmHome ? pickH : pickA, set: iAmHome ? setPickH : setPickA },
             { label: 'YOU GET (1–3)', list: iAmHome ? w.rosters?.away : w.rosters?.home, pick: iAmHome ? pickA : pickH, set: iAmHome ? setPickA : setPickH }];
        const openComposer = (mode: 'vows' | 'commish') => {
          if (open === mode) { setComposing(null); return; }
          setComposing({ id: w.id, mode }); setNote(null);
          setPickH(w.home.gives.map((p) => p.slug)); setPickA(w.away.gives.map((p) => p.slug));
        };
        return (
          <div key={w.id} style={{ marginTop: 10, ...(mine ? {} : { paddingTop: 10, borderTop: '1px solid var(--bd)' }) }}>
            <TradeBox w={w} home={w.home.gives} away={w.away.gives} />
            <div className="mono" style={{ fontSize: 10.5, color: 'var(--dim)', marginTop: 7, lineHeight: 1.5 }}>
              {weddingStatusShort(w)}
              {w.status === 'pending' && mine && <span style={{ color: 'var(--faint)' }} title="These players can’t be dropped, traded or moved to IR until it’s settled."> 🔒 Players locked.</span>}
            </div>
            {w.counter && w.status === 'pending' && (
              <div style={{ marginTop: 10, padding: '8px 9px 9px', borderRadius: 8, border: '1px solid color-mix(in srgb, var(--warn) 45%, var(--bd))', background: 'color-mix(in srgb, var(--warn) 6%, var(--surface))' }}>
                <div className="mono" style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--warn)' }}>NEW VOWS FROM {counterFrom!.toUpperCase()}</div>
                <TradeBox w={w} home={w.counter.home_gives} away={w.counter.away_gives} small />
              </div>
            )}
            {w.status === 'pending' && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                {w.can_accept && (
                  <button className="mono" disabled={busy} style={btn('you', busy)}
                    onClick={() => void act(() => shotgunAcceptCounter(w.id), '✓ married on your own vows')}>SAY YES TO THE NEW VOWS</button>
                )}
                {w.can_counter && (
                  <button className="mono" disabled={busy} style={btn('plain', busy)}
                    onClick={() => openComposer('vows')}>{open === 'vows' ? 'CLOSE' : 'PROPOSE NEW VOWS'}</button>
                )}
                {w.can_decline && (
                  <button className="mono" disabled={busy} style={btn('opp', busy)}
                    onClick={() => { if (window.confirm('Call off the wedding? Everyone keeps their players.')) void act(() => shotgunDecline(w.id), '✓ called off'); }}>
                    CALL IT OFF
                  </button>
                )}
                {boss && (
                  <button className="mono" disabled={busy} style={btn('plain', busy)}
                    onClick={() => openComposer('commish')}>{open === 'commish' ? 'CLOSE' : '✎ REWRITE (COMMISH)'}</button>
                )}
                {boss && !w.can_decline && (
                  <button className="mono" disabled={busy} style={btn('opp', busy)}
                    onClick={() => { if (window.confirm(`Call off ${w.home.team} and ${w.away.team}’s wedding? Everyone keeps their players.`)) void act(() => shotgunCommishDecline(w.id), '✓ called off'); }}>
                    CALL OFF (COMMISH)
                  </button>
                )}
              </div>
            )}
            {open && rows.every((r) => r.list) && (
              <div style={{ marginTop: 10, padding: 10, border: '1px dashed var(--bd)', borderRadius: 8 }}>
                {open === 'commish' && (
                  <div className="mono" style={{ fontSize: 10, color: 'var(--dim)', lineHeight: 1.5, marginBottom: 8 }}>
                    This replaces the trade that goes through at the deadline. The deadline and who can call it off stay as announced.
                  </div>
                )}
                {rows.map((r, i) => (
                  <div key={r.label}>
                    <div className="mono" style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--faint)', marginTop: i ? 10 : 0 }}>{r.label}</div>
                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 5 }}>
                      {(r.list ?? []).map((p) => (
                        <button key={p.slug} className="mono" style={chip(r.pick.includes(p.slug))} onClick={() => toggle(r.pick, r.set, p.slug)}>{weddingPlayerTag(p)}</button>
                      ))}
                    </div>
                  </div>
                ))}
                <button className="mono" disabled={busy || !pickH.length || !pickA.length} style={{ ...btn('you', busy), marginTop: 10 }}
                  onClick={() => void act(open === 'commish'
                    ? () => shotgunCommishEdit(w.id, pickH, pickA)
                    : () => shotgunCounter(w.id, pickH, pickA),
                  open === 'commish' ? '✓ vows rewritten — the league has been told' : '✓ new vows sent — they say yes, or the original goes through')}>
                  {open === 'commish' ? 'REWRITE THE VOWS' : 'SEND NEW VOWS'}
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
