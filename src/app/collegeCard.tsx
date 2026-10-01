// THE DEVY PLAYER CARD, web (0406) — the college twin of playerCard.tsx,
// opened by the same openPlayerCard bus for any c-<espn_id> slug. Its data is
// assembled in core (collegeCard.ts): ESPN's bio, seasons, game log and news,
// read when the card opens, and our side — the devy market price and
// StatHead's devy profile — from college_player_card. A part that can't be
// reached simply doesn't render; the card never shows an invented number.
import { useEffect, useState } from 'react';
import type { Pos } from '@drip/core/types';
import {
  loadCollegeEspn, loadCollegeGameLog, statheadEvalRows, storedSeasonRows, collegeFactStrip,
  type CollegeBio, type CollegeOverview, type CollegeGameRow, type DevyFormat,
} from '@drip/core/data/collegeCard';
import { collegeEspnId } from '@drip/core/data/college';
import { collegeClassLabel } from '@drip/core/data/college';
import { collegeHeadshot, collegeLogo } from '@drip/core/data/media';
import { collegePlayerCard, leagueGameMode, nativeRosters, matchupTeams, type CollegePlayerCard } from '@drip/core/data/liveApi';
import { leagueSuperflex } from '@drip/core/engine/classic';
import { kickoffLabel } from '@drip/core/data/nflSlate';
import { ModalBackdrop, Img, PosPill } from './ui';

export interface CollegeCardReq { slug: string; name: string; pos: string; team: string; leagueId?: string }

const label: React.CSSProperties = { fontSize: 8, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--faint)' };

export function CollegeCardModal({ req, onClose }: { req: CollegeCardReq; onClose: () => void }) {
  const { slug, name, pos, leagueId } = req;
  const espnId = collegeEspnId(slug) ?? '';
  const [card, setCard] = useState<CollegePlayerCard | null>(null);
  const [bio, setBio] = useState<CollegeBio | null>(null);
  const [ov, setOv] = useState<CollegeOverview | null>(null);
  const [espnDown, setEspnDown] = useState(false);
  const [fmt, setFmt] = useState<DevyFormat>('1qb');
  const [owner, setOwner] = useState<string | null | undefined>(undefined);
  const [tab, setTab] = useState<'summary' | 'seasons' | 'log'>('summary');
  const [log, setLog] = useState<CollegeGameRow[] | null>(null);
  const [logErr, setLogErr] = useState(false);

  useEffect(() => {
    let dead = false;
    setCard(null); setBio(null); setOv(null); setEspnDown(false); setLog(null); setLogErr(false); setOwner(undefined); setTab('summary');
    collegePlayerCard(espnId).then((c) => { if (!dead) setCard(c); }).catch(() => { if (!dead) setCard({ ok: false }); });
    loadCollegeEspn(espnId, pos).then((r) => {
      if (dead) return;
      setBio(r.bio); setOv(r.overview); setEspnDown(!r.bio && !r.overview);
    }).catch(() => { if (!dead) setEspnDown(true); });
    if (leagueId) {
      leagueGameMode(leagueId).then((g) => { if (!dead && g.ok) setFmt(leagueSuperflex(g) ? 'sf' : '1qb'); }).catch(() => {});
      nativeRosters(leagueId).then(async (rows) => {
        const held = rows.find((r) => r.slug === slug);
        if (dead) return;
        if (!held) { setOwner(null); return; }
        const teams = await matchupTeams(leagueId, [held.roster_id]).catch(() => ({} as Record<number, { team_name: string }>));
        if (!dead) setOwner(teams[held.roster_id]?.team_name ?? `Roster ${held.roster_id}`);
      }).catch(() => {});
    }
    return () => { dead = true; };
  }, [espnId, slug, pos, leagueId]);

  useEffect(() => {
    if (tab !== 'log' || log !== null) return;
    let dead = false;
    loadCollegeGameLog(espnId, pos).then((r) => { if (!dead) setLog(r); }).catch(() => { if (!dead) setLogErr(true); });
    return () => { dead = true; };
  }, [tab, log, espnId, pos]);

  const school = card?.school ?? req.team;
  const abbr = card?.school_abbr ?? req.team;
  const evalRows = statheadEvalRows(card?.stathead?.card, pos, fmt);
  const seasons = ov?.seasons?.length ? ov.seasons : storedSeasonRows(card);
  const facts = collegeFactStrip(card, bio, fmt);
  const cls = bio?.classLabel ?? (card?.class_year ? collegeClassLabel(card.class_year) : null);
  const row = (k: string, v: string) => (
    <div style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
      <span className="mono" style={{ flex: 'none', width: 78, ...label, fontSize: 8.5 }}>{k}</span>
      <span className="mono" style={{ fontSize: 11, color: 'var(--text)', minWidth: 0, lineHeight: 1.45 }}>{v}</span>
    </div>
  );

  return (
    <ModalBackdrop onClick={onClose} zIndex={90}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(440px, 92vw)', background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 8, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <Img src={bio?.headshot ?? collegeHeadshot(espnId)} size={56} radius={28} alt={name}
            fallback={<div style={{ width: 56, height: 56, borderRadius: 28, background: 'var(--bg)', border: '1px solid var(--bd)' }} />} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="grotesk" style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{card?.name ?? name}</div>
            <div className="mono" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: 'var(--dim)', marginTop: 3, flexWrap: 'wrap' }}>
              <PosPill pos={pos as Pos} />
              <Img src={collegeLogo(abbr)} size={13} radius={2} fallback={<span />} />
              <span>{school}</span>
              {card?.division === 'FCS' && <span style={{ fontWeight: 700 }}>· FCS</span>}
              {card?.conference && card.division !== 'FCS' && <span>· {card.conference}</span>}
              {bio?.jersey && <span>· #{bio.jersey}</span>}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', borderTop: '1px solid var(--bd)', borderBottom: '1px solid var(--bd)', padding: '9px 0' }}>
          {facts.map(([k, v]) => (
            <div key={k} style={{ flex: 1, textAlign: 'center' }}>
              <div className="mono" style={label}>{k}</div>
              <div className="grotesk" style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)', marginTop: 2 }}>{v}</div>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {([['summary', 'SUMMARY'], ['seasons', 'SEASONS'], ['log', 'GAME LOG']] as const).map(([id, l]) => (
            <button key={id} onClick={() => setTab(id)} className="mono"
              style={{ fontSize: 9.5, fontWeight: 700, cursor: 'pointer', borderRadius: 5, padding: '5px 10px',
                color: tab === id ? 'var(--you)' : 'var(--dim)', background: tab === id ? 'var(--bg)' : 'transparent',
                border: `1px solid ${tab === id ? 'var(--you)' : 'var(--bd)'}` }}>{l}</button>
          ))}
        </div>

        {tab === 'summary' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 380, overflowY: 'auto' }}>
            {card?.graduated_to && row('TURNED PRO', 'drafted into the NFL — his card now lives under his NFL name')}
            {card && card.active === false && !card.graduated_to && row('STATUS', 'left college')}
            {evalRows.length > 0 && (
              <div style={{ borderBottom: '1px solid var(--bd)', paddingBottom: 8, marginBottom: 2, display: 'flex', flexDirection: 'column', gap: 5 }}>
                <div className="mono" style={label}>🔬 EVALUATION · STATHEAD{fmt === 'sf' ? ' · SUPERFLEX' : ''}</div>
                {evalRows.map((r) => row(r.label, r.value))}
              </div>
            )}
            {card?.market && row('DEVY PRICE', `${card.market.price} a share${card.market.rank ? ` · #${card.market.rank} in college` : ' · unpriced (the floor)'}${card.market.youth ? ' · young riser' : ''}${card.market.frozen ? ' · frozen for the offseason' : ''}`)}
            {owner !== undefined && row('ROSTERED', owner ? `⇄ ${owner}` : 'nobody in this league holds him')}
            {ov?.next?.short && row('NEXT UP', `${ov.next.short}${ov.next.date && Number.isFinite(Date.parse(ov.next.date)) ? ` · ${kickoffLabel(Date.parse(ov.next.date))}` : ''}`)}
            {(bio?.hometown || cls) && row('BIO', [cls, bio?.hometown].filter(Boolean).join(' · '))}
            {seasons[0] && row(seasons[0].season, `${seasons[0].line}${seasons[0].pts != null ? ` · ${seasons[0].pts} PPR` : ''}`)}
            {(ov?.news ?? []).length > 0 && (
              <div style={{ borderTop: '1px solid var(--bd)', paddingTop: 6, marginTop: 2 }}>
                <div className="mono" style={label}>📰 LATELY</div>
                {(ov?.news ?? []).slice(0, 4).map((n) => (
                  <a key={n.id} href={n.url ?? '#'} target="_blank" rel="noreferrer"
                    style={{ display: 'block', fontSize: 11, color: 'var(--text)', textDecoration: 'none', marginTop: 4, lineHeight: 1.4 }}>
                    {n.headline}
                    <span className="mono" style={{ display: 'block', fontSize: 8.5, color: 'var(--faint)' }}>
                      {n.at ? new Date(n.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''}{n.url ? ' · espn.com' : ''}
                    </span>
                  </a>
                ))}
              </div>
            )}
            {espnDown && <span className="mono" style={{ fontSize: 9.5, color: 'var(--faint)' }}>ESPN didn’t answer, so news and bio are missing; the seasons below are ours.</span>}
          </div>
        )}

        {tab === 'seasons' && (
          <div style={{ maxHeight: 320, overflowY: 'auto' }}>
            {seasons.length === 0 && <span className="mono" style={{ fontSize: 10, color: 'var(--faint)' }}>{ov || card ? 'No college stats yet — a recruit, or a player who hasn’t touched the ball.' : 'Loading…'}</span>}
            {seasons.map((s) => (
              <div key={s.season} style={{ display: 'flex', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--bd)', alignItems: 'baseline' }}>
                <span className="mono" style={{ width: 38, fontSize: 10, fontWeight: 700, color: 'var(--text)' }}>{s.season}</span>
                <span className="mono" style={{ flex: 1, fontSize: 9.5, lineHeight: 1.4, color: 'var(--text)' }}>{s.line}</span>
                {s.pts != null && <span className="mono" style={{ width: 52, textAlign: 'right', fontSize: 10.5, fontWeight: 700, color: 'var(--you)' }}>{s.pts}</span>}
              </div>
            ))}
            {seasons.length > 0 && <div className="mono" style={{ fontSize: 9, color: 'var(--faint)', marginTop: 8 }}>Season totals · PPR points</div>}
          </div>
        )}

        {tab === 'log' && (
          <div style={{ maxHeight: 320, overflowY: 'auto' }}>
            {logErr && <span className="mono" style={{ fontSize: 10, color: 'var(--opp)' }}>Couldn’t load his games from ESPN.</span>}
            {!logErr && log === null && <span className="mono" style={{ fontSize: 10, color: 'var(--faint)' }}>Loading his season…</span>}
            {log?.length === 0 && <span className="mono" style={{ fontSize: 10, color: 'var(--faint)' }}>No games played this season yet.</span>}
            {!!log?.length && (
              <div style={{ display: 'flex', paddingBottom: 4, borderBottom: '1px solid var(--bd)' }}>
                {['WK', 'OPP', 'RESULT', 'STAT LINE'].map((h, i) => (
                  <span key={h} className="mono" style={{ ...label, width: [28, 58, 62, undefined][i], flex: i === 3 ? 1 : undefined }}>{h}</span>
                ))}
                <span className="mono" style={{ ...label, width: 40, textAlign: 'right' }}>PPR</span>
              </div>
            )}
            {log?.map((g) => (
              <div key={g.id} style={{ display: 'flex', alignItems: 'flex-start', padding: '5px 0', borderBottom: '1px solid var(--bd)' }}>
                <span className="mono" style={{ width: 28, fontSize: 10, fontWeight: 700, color: 'var(--text)' }}>{g.week ?? '—'}</span>
                <span className="mono" style={{ width: 58, fontSize: 9.5, color: 'var(--dim)' }}>{g.atVs === '@' ? '@' : 'vs'} {g.opp ?? '—'}</span>
                <span className="mono" style={{ width: 62, fontSize: 9.5, color: g.result === 'W' ? 'var(--you)' : g.result === 'L' ? 'var(--opp)' : 'var(--dim)' }}>{g.result ?? ''} {g.score ?? ''}</span>
                <span className="mono" style={{ flex: 1, fontSize: 9.5, lineHeight: 1.4, color: 'var(--text)' }}>{g.line}</span>
                <span className="mono" style={{ width: 40, textAlign: 'right', fontSize: 10.5, fontWeight: 700, color: g.pts > 0 ? 'var(--you)' : 'var(--faint)' }}>{g.pts}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </ModalBackdrop>
  );
}
