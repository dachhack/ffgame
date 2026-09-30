// A SPORT PLAYER'S CARD (0403) — what the player card shows for a key like
// nba-1658 in place of the NFL bio and statline: the directory's facts
// (team, eligibility, injury, rank), the season as per-game numbers, and
// his last ten games with the points each would score under the league
// the card was opened from (or the sport's default table).
import { useEffect, useMemo, useState } from 'react';
import { SPORTS, parsePlayerKey, eligibleFor } from '@drip/core/sports/index';
import { seasonCardStats, gameCardStats, seasonPoints } from '@drip/core/sports/card';
import { isMarkFree } from '@drip/core/data/markFree';
import { linePoints, normalizeScoring } from '@drip/core/sports/score';
import { sportSettingsOf } from '@drip/core/sports/league';
import { sportPlayerCard, leagueGameMode, myFavorites, setFavorite, type SportCard } from '@drip/core/data/liveApi';
import { ModalBackdrop, PlayerImg, PosPill, Img } from './ui';
import type { PlayerCardReq } from './playerCard';

const fmtDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', timeZone: 'UTC' });

export function SportCardModal({ req, onClose }: { req: PlayerCardReq; onClose: () => void }) {
  const { slug, name, userId, leagueId } = req;
  const parsed = parsePlayerKey(slug);
  const def = SPORTS[parsed?.sport ?? 'nba'];
  const [card, setCard] = useState<SportCard | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [scoring, setScoring] = useState<Record<string, number>>(() => normalizeScoring(def));
  const [starred, setStarred] = useState<boolean | null>(null);

  useEffect(() => {
    let dead = false;
    setCard(null); setErr(null);
    sportPlayerCard(slug).then((c) => { if (!dead) setCard(c); }).catch((e) => { if (!dead) setErr(String(e?.message ?? e)); });
    if (leagueId) leagueGameMode(leagueId).then((gm) => {
      if (dead || !gm.ok) return;
      const st = sportSettingsOf({ sport: gm.sport_settings });
      setScoring(normalizeScoring(def, st?.scoring));
    }).catch(() => {});
    if (userId) myFavorites().then((f) => { if (!dead) setStarred(f.has(slug)); }).catch(() => {});
    return () => { dead = true; };
  }, [slug, leagueId, userId, def]);

  const p = card?.player ?? null;
  const pos = p?.pos ?? req.pos;
  const team = p?.team ?? req.team;
  const season = useMemo(() => seasonCardStats(def, p?.season_line, pos), [def, p?.season_line, pos]);
  const fptsPerGame = p?.season_line && p.gp ? (seasonPoints(def, p.season_line, scoring) / p.gp) : null;
  const inj = p?.injury_status ? def.injuryStatuses.find((i) => i.code === p.injury_status) : null;
  const toggleStar = () => {
    if (!userId || starred == null) return;
    const next = !starred;
    setStarred(next);
    setFavorite(userId, slug, next).catch(() => setStarred(!next));
  };

  return (
    <ModalBackdrop onClick={onClose} zIndex={90}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(440px, 92vw)', background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 8, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          {/* The directory's own headshot URL when there is one and marks are
              shown; the pill otherwise (media.ts knows nothing of sport keys). */}
          {p?.headshot && !isMarkFree()
            ? <Img src={p.headshot} size={56} radius={17} alt={slug} fallback={<PlayerImg playerId={slug} team={team} pos={pos} size={56} />} />
            : <PlayerImg playerId={slug} team={team} pos={pos} size={56} />}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="grotesk" style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p?.full_name ?? name}</div>
            <div className="mono" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: 'var(--dim)', marginTop: 3, flexWrap: 'wrap' }}>
              {(p?.eligible?.length ? p.eligible : eligibleFor(def.id, pos)).map((e) => <PosPill key={e} pos={e} />)}
              <span>{team || 'FA'}</span>
              {p?.jersey && <span>· #{p.jersey}</span>}
              {inj && <span style={{ color: inj.out ? 'var(--opp)' : 'var(--warn)', fontWeight: 700 }}>· {inj.label}{p?.injury_note ? ` — ${p.injury_note}` : ''}</span>}
            </div>
          </div>
          {userId && starred != null && (
            <button onClick={toggleStar} title={starred ? 'Unstar' : 'Star'} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: starred ? '#E8B23A' : 'var(--faint)', lineHeight: 1 }}>{starred ? '★' : '☆'}</button>
          )}
        </div>

        <div style={{ display: 'flex', borderTop: '1px solid var(--bd)', borderBottom: '1px solid var(--bd)', padding: '9px 0' }}>
          {([
            ['RANK', p?.rank != null ? `#${p.rank}` : '—'],
            ['FPTS/G', fptsPerGame != null ? fptsPerGame.toFixed(1) : '—'],
            ['GP', p?.gp ? String(p.gp) : '—'],
            ['SEASON', p?.season ? (def.id === 'nba' || def.id === 'nhl' ? `${p.season}-${String(Number(p.season) + 1).slice(2)}` : p.season) : '—'],
          ] as [string, string][]).map(([k, v]) => (
            <div key={k} style={{ flex: 1, textAlign: 'center' }}>
              <div className="mono" style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--faint)' }}>{k}</div>
              <div className="mono" style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginTop: 2 }}>{v}</div>
            </div>
          ))}
        </div>

        {err && <div className="mono" style={{ fontSize: 10, color: 'var(--opp)' }}>{err}</div>}
        {!card && !err && <div className="mono" style={{ fontSize: 10, color: 'var(--faint)' }}>reading…</div>}

        {season.length > 0 && (
          <div>
            <div className="mono" style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--faint)', marginBottom: 5 }}>SEASON · PER GAME</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(64px, 1fr))', gap: 5 }}>
              {season.map((c) => (
                <div key={c.short} className="mono" style={{ border: '1px solid var(--bd)', borderRadius: 5, padding: '4px 6px', textAlign: 'center' }}>
                  <div style={{ fontSize: 8, color: 'var(--faint)', fontWeight: 700, letterSpacing: '0.06em' }}>{c.short}</div>
                  <div style={{ fontSize: 12, color: 'var(--text)', fontWeight: 700 }}>{c.value}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {card && (
          <div>
            <div className="mono" style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--faint)', marginBottom: 5 }}>LAST GAMES</div>
            {card.games.length === 0 ? (
              <div className="mono" style={{ fontSize: 10, color: 'var(--faint)' }}>No games recorded yet this season.</div>
            ) : (
              <div style={{ display: 'grid', gap: 3, maxHeight: 220, overflowY: 'auto' }}>
                {card.games.map((g) => (
                  <div key={g.game_id} className="mono" style={{ display: 'grid', gridTemplateColumns: '40px 58px minmax(0, 1fr) 44px', gap: 6, alignItems: 'center', fontSize: 10 }}>
                    <span style={{ color: 'var(--faint)' }}>{fmtDay(g.game_date)}</span>
                    <span style={{ color: 'var(--dim)' }}>{g.home ? 'vs' : '@'} {g.opp}{g.status === 'live' ? ' ●' : ''}</span>
                    <span style={{ color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {g.played && g.line ? gameCardStats(def, g.line, pos).map((c) => `${c.value} ${c.short}`).join(' · ') || '—' : 'DNP'}
                    </span>
                    <span style={{ textAlign: 'right', fontWeight: 700, color: g.played && g.line ? 'var(--text)' : 'var(--faint)' }}>{g.played && g.line ? linePoints(def, g.line, scoring).toFixed(1) : '—'}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="mono" style={{ fontSize: 9.5, color: 'var(--faint)', lineHeight: 1.5 }}>
          Points under {leagueId ? "this league's" : `the ${def.league} default`} scoring. Rank is fantasy points over the ranking season.
        </div>
        <button onClick={onClose} className="mono" style={{ alignSelf: 'flex-end', background: 'none', border: '1px solid var(--bd)', borderRadius: 6, padding: '5px 12px', fontSize: 10.5, color: 'var(--dim)', cursor: 'pointer' }}>CLOSE</button>
      </div>
    </ModalBackdrop>
  );
}
