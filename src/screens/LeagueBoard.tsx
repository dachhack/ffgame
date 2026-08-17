// The public LEAGUE BOARD, web (v0.255.0) — browse open leagues, look inside,
// claim a seat. The app has had this since v0.226.0 (Recruit); the web — the
// surface the ads funnel actually lands people on — offered only the
// invite-code path, which assumes you already know somebody. Same RPCs as the
// app (league_board / league_preview / join_from_board), so the listings, the
// no-invite-code rule, and the seat logic are one implementation with two
// faces.
//
// Commissioners get the posting half at the bottom: any of their NATIVE
// leagues can go on the board with a blurb (the board's promise is a claimable
// seat, so only native leagues — the ones with seats we control — can list).
import { useCallback, useEffect, useState } from 'react';
import {
  leagueBoard, leaguePreview, joinFromBoard, postLeagueListing, closeLeagueListing,
  commishOverview, friendlyError,
  type BoardListing, type BoardPreview, type AdminLeague,
} from '@drip/core/data/liveApi';

const card: React.CSSProperties = { background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 8, padding: 16 };
const label: React.CSSProperties = { fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--faint)' };
const btn: React.CSSProperties = { fontFamily: 'inherit', fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--on-accent)', background: 'var(--you)', border: 'none', borderRadius: 6, padding: '9px 14px', cursor: 'pointer' };
const ghostBtn: React.CSSProperties = { fontFamily: 'inherit', fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--dim)', background: 'none', border: '1px solid var(--bd)', borderRadius: 6, padding: '7px 12px', cursor: 'pointer' };
const input: React.CSSProperties = { fontFamily: 'inherit', fontSize: 13, color: 'var(--text)', background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 6, padding: '9px 10px', outline: 'none', width: '100%', boxSizing: 'border-box' };
const linkBtn: React.CSSProperties = { background: 'none', border: 'none', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--dim)', cursor: 'pointer' };
const errStyle: React.CSSProperties = { fontSize: 10.5, color: 'var(--warn, #c66)', marginTop: 10, lineHeight: 1.5 };

const modeChip = (mode?: string | null) => mode == null ? null : (
  <span className="mono" style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.08em', color: mode === 'classic' ? 'var(--text)' : 'var(--you)', border: '1px solid var(--bd)', borderRadius: 999, padding: '2px 8px' }}>
    {mode === 'classic' ? '🏈 NORMAL' : '◈ DRIP'}
  </span>
);

export function LeagueBoard({ onJoined, onBack }: { onJoined: () => void; onBack: () => void }) {
  const [rows, setRows] = useState<BoardListing[] | null>(null);
  const [myLeagues, setMyLeagues] = useState<AdminLeague[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [previewFor, setPreviewFor] = useState<BoardListing | null>(null);
  const [preview, setPreview] = useState<BoardPreview | null>(null);
  const [teamDraft, setTeamDraft] = useState('');
  const [joined, setJoined] = useState<string | null>(null);
  const [postFor, setPostFor] = useState<AdminLeague | null>(null);
  const [blurbDraft, setBlurbDraft] = useState('');

  const load = useCallback(async () => {
    setErr(null);
    try {
      const [b, cl] = await Promise.all([
        leagueBoard(),
        // The commissioner's own leagues feed the POST section — native only:
        // the board's promise is a claimable seat.
        commishOverview().then((ls) => ls.filter((l) => l.provider === 'native')).catch(() => [] as AdminLeague[]),
      ]);
      setRows(b); setMyLeagues(cl);
    } catch (e) { setErr(friendlyError(e)); setRows([]); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // Look before you join (0156): the preview loads when a listing opens.
  useEffect(() => {
    if (!previewFor) { setPreview(null); return; }
    let alive = true;
    leaguePreview(previewFor.league_id).then((p) => { if (alive) setPreview(p); }).catch(() => {});
    return () => { alive = false; };
  }, [previewFor]);

  const doJoin = async () => {
    if (!previewFor || busy) return;
    setBusy(true); setErr(null);
    const target = previewFor;
    try {
      const r = await joinFromBoard(target.league_id, teamDraft.trim() || undefined);
      if (!r.ok) setErr(friendlyError(r.error ?? 'could not join'));
      else if ((r as { status?: string }).status === 'waitlisted') {
        setJoined(`the waiting room for ${target.name} — the commissioner deals you in from there`); onJoined();
      } else { setJoined(target.name); onJoined(); }
    } catch (e) { setErr(friendlyError(e)); }
    finally { setBusy(false); setPreviewFor(null); setTeamDraft(''); await load(); }
  };

  const doPost = async () => {
    if (!postFor || busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await postLeagueListing(postFor.league_id, blurbDraft.trim() || null);
      if (!r.ok) setErr(friendlyError(r.error ?? 'could not post'));
    } catch (e) { setErr(friendlyError(e)); }
    finally { setBusy(false); setPostFor(null); setBlurbDraft(''); await load(); }
  };

  const unlist = async (leagueId: string) => {
    if (busy) return;
    setBusy(true);
    try { const r = await closeLeagueListing(leagueId); if (!r.ok) setErr(friendlyError(r.error ?? 'could not unlist')); }
    catch (e) { setErr(friendlyError(e)); }
    finally { setBusy(false); await load(); }
  };

  const listedIds = new Set((rows ?? []).filter((r) => r.commish).map((r) => r.league_id));

  if (rows === null) return <div className="mono" style={{ padding: 24, fontSize: 11, color: 'var(--faint)', textAlign: 'center' }}>Loading the league board…</div>;

  return (
    <>
      <div style={{ textAlign: 'center', marginBottom: 20 }}>
        <div className="grotesk" style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text)' }}>Open leagues</div>
        <div style={{ fontSize: 12.5, color: 'var(--dim)', marginTop: 8, lineHeight: 1.5 }}>
          Leagues with a seat to claim — no invite code needed. Look inside before you join.
        </div>
      </div>

      {joined && (
        <div style={{ ...card, borderColor: 'var(--you)', marginBottom: 12 }}>
          <div className="mono" style={{ fontSize: 11, color: 'var(--you)', lineHeight: 1.5 }}>✓ You’re in {joined}. It’s on your leagues screen.</div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {rows.length === 0 && (
          <div style={{ ...card, textAlign: 'center' }}>
            <div className="mono" style={{ fontSize: 10.5, color: 'var(--faint)', lineHeight: 1.6 }}>
              Nothing posted right now. Leagues appear here when a commissioner lists an open seat — check back, or join with an invite code instead.
            </div>
          </div>
        )}
        {rows.map((r) => (
          <div key={r.league_id} style={card}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {r.avatar_url
                ? <img src={r.avatar_url} alt="" width={34} height={34} style={{ borderRadius: 7, objectFit: 'cover', flexShrink: 0 }} />
                : <span style={{ width: 34, height: 34, borderRadius: 7, background: 'var(--bg)', border: '1px solid var(--bd)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: 'var(--faint)', flexShrink: 0 }}>{r.name.charAt(0).toUpperCase()}</span>}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="grotesk" style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</div>
                <div className="mono" style={{ fontSize: 9.5, color: 'var(--dim)', marginTop: 3 }}>
                  {r.seats_open} open seat{r.seats_open === 1 ? '' : 's'} of {r.seats_total} · draft {r.draft_status} · {r.draft_mode}
                  {r.mine && <span style={{ color: 'var(--you)' }}> · YOU’RE IN THIS ONE</span>}
                </div>
              </div>
              {r.commish
                ? <button onClick={() => void unlist(r.league_id)} className="mono" style={ghostBtn}>UNLIST</button>
                : <button onClick={() => { setPreviewFor(r); setErr(null); }} className="mono" style={{ ...btn, opacity: r.mine ? 0.55 : 1 }} disabled={r.mine}>
                    {r.mine ? 'JOINED' : 'LOOK INSIDE →'}
                  </button>}
            </div>
            {r.blurb && <div style={{ fontSize: 11.5, color: 'var(--dim)', marginTop: 9, lineHeight: 1.5 }}>{r.blurb}</div>}
          </div>
        ))}
      </div>

      {/* ── The commissioner's posting half ─────────────────────────────────── */}
      {myLeagues.length > 0 && (
        <div style={{ ...card, marginTop: 14 }}>
          <div className="mono" style={label}>YOUR LEAGUES — POST THEM HERE</div>
          {myLeagues.map((l) => {
            const listed = listedIds.has(l.league_id);
            const open = l.rosters - l.enrolled;
            return (
              <div key={l.league_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderTop: '1px solid var(--bd)', marginTop: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.name}</div>
                  <div className="mono" style={{ fontSize: 9, color: 'var(--faint)', marginTop: 2 }}>
                    {open > 0 ? `${open} open seat${open === 1 ? '' : 's'}` : 'full'}{listed ? ' · ON THE BOARD' : ''}
                  </div>
                </div>
                {listed
                  ? <button onClick={() => void unlist(l.league_id)} className="mono" style={ghostBtn}>UNLIST</button>
                  : <button onClick={() => { setPostFor(l); setBlurbDraft(''); }} className="mono" style={{ ...ghostBtn, color: 'var(--you)', borderColor: 'color-mix(in srgb, var(--you) 35%, var(--bd))' }} disabled={open <= 0} title={open <= 0 ? 'No open seats to offer' : undefined}>POST</button>}
              </div>
            );
          })}
        </div>
      )}

      {err && !previewFor && !postFor && <div className="mono" style={errStyle}>{err}</div>}
      <div style={{ textAlign: 'center', marginTop: 16 }}><button onClick={onBack} className="mono" style={linkBtn}>← back</button></div>

      {/* ── LOOK INSIDE → CLAIM ─────────────────────────────────────────────── */}
      {previewFor && (
        <div onClick={() => setPreviewFor(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ ...card, width: 'min(480px, 100%)', maxHeight: '85vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div className="grotesk" style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)', flex: 1, minWidth: 0 }}>{previewFor.name}</div>
              {modeChip(preview?.game_mode)}
            </div>
            {preview?.blurb && <div style={{ fontSize: 11.5, color: 'var(--dim)', marginTop: 8, lineHeight: 1.5 }}>{preview.blurb}</div>}
            {!preview && <div className="mono" style={{ fontSize: 10, color: 'var(--faint)', marginTop: 10 }}>Loading the details…</div>}
            {preview?.ok && (
              <>
                <div className="mono" style={{ fontSize: 10, color: 'var(--dim)', marginTop: 12, lineHeight: 1.8 }}>
                  {preview.seats_open} of {preview.seats_total} seats open<br />
                  {preview.draft && <>draft: {preview.draft.status} · {preview.draft.mode} · {preview.draft.rounds} rounds{preview.draft.budget ? ` · $${preview.draft.budget}` : ''}<br /></>}
                  {preview.game_mode === 'classic'
                    ? <>scoring: standard{preview.ppr === 1 ? ', full PPR' : preview.ppr === 0.5 ? ', half PPR' : preview.ppr === 0 ? ', non-PPR' : ''}{preview.bestball?.length ? ' · best-ball spots' : ''}<br /></>
                    : <>the drip game: live head-to-head, drips, nukes and power-ups<br /></>}
                </div>
                {preview.teams && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 10 }}>
                    {preview.teams.map((t) => (
                      <span key={t.roster_id} className="mono" style={{ fontSize: 8.5, fontWeight: 700, color: t.taken ? 'var(--faint)' : 'var(--you)', border: '1px solid var(--bd)', borderRadius: 999, padding: '3px 8px', textDecoration: t.taken ? 'line-through' : 'none' }}>
                        {t.team_name || `Team ${t.roster_id}`}
                      </span>
                    ))}
                  </div>
                )}
                <div className="mono" style={{ ...label, marginTop: 14 }}>YOUR TEAM NAME (OPTIONAL)</div>
                <input value={teamDraft} maxLength={30} onChange={(e) => setTeamDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void doJoin(); }} placeholder="e.g. Waiver Wire Wolves" style={{ ...input, marginTop: 6 }} />
                <button onClick={() => void doJoin()} disabled={busy} className="mono" style={{ ...btn, width: '100%', marginTop: 12, opacity: busy ? 0.6 : 1 }}>
                  {busy ? 'CLAIMING…' : 'CLAIM A SEAT →'}
                </button>
              </>
            )}
            {preview && !preview.ok && <div className="mono" style={errStyle}>{friendlyError(preview.error ?? 'this league is no longer open')}</div>}
            {err && <div className="mono" style={errStyle}>{err}</div>}
            <div style={{ textAlign: 'center', marginTop: 10 }}><button onClick={() => setPreviewFor(null)} className="mono" style={linkBtn}>close</button></div>
          </div>
        </div>
      )}

      {/* ── POST a league ───────────────────────────────────────────────────── */}
      {postFor && (
        <div onClick={() => setPostFor(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ ...card, width: 'min(440px, 100%)' }}>
            <div className="grotesk" style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>Post {postFor.name}</div>
            <div className="mono" style={{ fontSize: 9.5, color: 'var(--dim)', marginTop: 6, lineHeight: 1.5 }}>
              Anyone signed in can claim an open seat — no invite code. Unlist any time.
            </div>
            <div className="mono" style={{ ...label, marginTop: 12 }}>BLURB (OPTIONAL)</div>
            <textarea value={blurbDraft} maxLength={200} rows={3} onChange={(e) => setBlurbDraft(e.target.value)}
              placeholder="e.g. Friendly 8-teamer, drafting Thursday night, no trades after week 10." style={{ ...input, marginTop: 6, resize: 'vertical' }} />
            <button onClick={() => void doPost()} disabled={busy} className="mono" style={{ ...btn, width: '100%', marginTop: 12, opacity: busy ? 0.6 : 1 }}>
              {busy ? 'POSTING…' : 'PUT IT ON THE BOARD →'}
            </button>
            {err && <div className="mono" style={errStyle}>{err}</div>}
            <div style={{ textAlign: 'center', marginTop: 10 }}><button onClick={() => setPostFor(null)} className="mono" style={linkBtn}>cancel</button></div>
          </div>
        </div>
      )}
    </>
  );
}
