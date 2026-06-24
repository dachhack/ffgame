// Admin "feed sheet": the per-player play-by-play contact sheet (headshots +
// running PPR log) for a real matchup's two lineups, rendered live in-app from
// the baked source week — the same data the live sim drips into live_play. It's
// the React twin of scripts/feedlog.mjs, scoped to one matchup's players.
import { useEffect, useState } from 'react';
import { adminMatchupPicks, type MatchupPicks } from '../data/liveApi';
import { loadRealWeek, realPbpFor, realPointsFor, type RealPlay } from '../data/realPbp';
import { slugMeta } from '../data/slugMeta';
import { PlayerImg } from '../app/ui';
import type { Pos } from '../types';

const mono: React.CSSProperties = { fontFamily: 'var(--mono, monospace)' };
const linkBtn: React.CSSProperties = { background: 'none', border: 'none', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--dim)', cursor: 'pointer' };

const round = (n: number) => Math.round(n * 10) / 10;
const fmtClock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const fmtSlug = (slug: string) =>
  slug.replace(/-\d+$/, '').split('-').map((w) => (w.length <= 2 ? w.toUpperCase() : w.startsWith('mc') ? 'Mc' + w[2].toUpperCase() + w.slice(3) : w[0].toUpperCase() + w.slice(1))).join(' ');

const KIND: Record<string, string> = { pass: 'pass', rush: 'rush', rec: 'catch', fg: 'field goal', xp: 'XP', sack: 'sack', int: 'INT', fumrec: 'fum rec', dst_td: 'DEF TD', safety: 'safety', incomplete: 'incomplete', fgmiss: 'FG miss', xpmiss: 'XP miss', return: 'return', tackle: 'tackle' };

// Base PPR per play — mirrors server/src/simulate.js:baseScore + scripts/feedlog.mjs.
function delta(p: RealPlay): number {
  if (p.k === 'pass') return p.y * 0.04 + (p.td ? 4 : 0);
  if (p.k === 'rush') return p.y * 0.1 + (p.td ? 6 : 0);
  if (p.k === 'rec') return 1 + p.y * 0.1 + (p.td ? 6 : 0);
  if (p.k === 'fg') return p.y < 40 ? 3 : p.y < 50 ? 4 : 5;
  if (p.k === 'xp' || p.k === 'sack') return 1;
  if (p.k === 'int') return 3;
  if (p.k === 'fumrec') return 2;
  if (p.k === 'dst_td') return 6;
  if (p.k === 'safety') return 2;
  return 0;
}

interface SidePlayer { slug: string; pos: Pos; team: string }

/** A side's player slugs: its sealed picks if enrolled, else its Sleeper lineup. */
function sideSlugs(data: MatchupPicks, side: 'home' | 'away'): SidePlayer[] {
  const appUser = side === 'home' ? data.home_app_user : data.away_app_user;
  const picks = appUser ? data.picks.filter((p) => p.app_user_id === appUser && p.player_slug) : [];
  const raw = picks.length
    ? picks.map((p) => p.player_slug!)
    : ((side === 'home' ? data.home_lineup : data.away_lineup) ?? []).map((e) => e.player_slug).filter((s): s is string => !!s);
  const seen = new Set<string>();
  const out: SidePlayer[] = [];
  for (const slug of raw) {
    if (seen.has(slug)) continue;
    seen.add(slug);
    const m = slugMeta(slug);
    out.push({ slug, pos: m.pos, team: m.team });
  }
  return out;
}

function PlayerCard({ p, week }: { p: SidePlayer; week: number }) {
  const plays = (realPbpFor(week, p.slug) ?? []).slice().sort((a, b) => (a.t ?? a.c ?? 0) - (b.t ?? b.c ?? 0));
  const total = realPointsFor(week)[p.slug];
  let run = 0;
  const rows = plays.map((pl, i) => {
    const d = delta(pl); run += d;
    const showYd = ['pass', 'rush', 'rec', 'fg', 'return'].includes(pl.k);
    return (
      <div key={i} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto auto auto', gap: 6, alignItems: 'baseline', padding: '1.5px 0', fontSize: 10, ...mono }}>
        <span style={{ color: 'var(--faint)', minWidth: 38 }}>t+{fmtClock(pl.t ?? pl.c ?? 0)}</span>
        <span style={{ color: pl.td ? 'var(--you)' : 'var(--dim)' }}>{KIND[pl.k] ?? pl.k}{pl.td ? ' ●' : ''}</span>
        <span style={{ color: 'var(--text)', textAlign: 'right' }}>{showYd ? `${pl.y} yd` : ''}</span>
        <span style={{ color: d < 0 ? 'var(--opp)' : 'var(--faint)', textAlign: 'right', minWidth: 30 }}>{d ? `${d > 0 ? '+' : ''}${round(d)}` : '·'}</span>
        <span style={{ color: pl.td ? 'var(--you)' : 'var(--text)', fontWeight: 700, textAlign: 'right', minWidth: 34 }}>{round(run)}</span>
      </div>
    );
  });
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 7, padding: 9, marginBottom: 7 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <PlayerImg playerId={p.slug} team={p.team} pos={p.pos} size={34} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{fmtSlug(p.slug)}</div>
          <div style={{ ...mono, fontSize: 9, color: 'var(--dim)' }}>{p.pos} {p.team} · {plays.length} plays</div>
        </div>
        <div className="grotesk" style={{ fontSize: 19, fontWeight: 800, color: 'var(--you)', lineHeight: 1 }}>{total != null ? round(total) : '—'}<span style={{ ...mono, display: 'block', fontSize: 7.5, color: 'var(--faint)', fontWeight: 700, letterSpacing: '0.1em', textAlign: 'right' }}>PTS</span></div>
      </div>
      {plays.length === 0
        ? <div style={{ ...mono, fontSize: 9.5, color: 'var(--faint)', marginTop: 6 }}>no baked plays for week {week}</div>
        : <div style={{ marginTop: 7, borderTop: '1px solid var(--bd)', paddingTop: 5 }}>{rows}</div>}
    </div>
  );
}

export function FeedSheet({ matchupId, week, onClose }: { matchupId: string; week: number; onClose: () => void }) {
  const [data, setData] = useState<MatchupPicks | null>(null);
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const d = await adminMatchupPicks(matchupId);
        await loadRealWeek(week);
        if (alive) { setData(d); setReady(true); }
      } catch (e) { if (alive) setErr(e instanceof Error ? e.message : 'load failed'); }
    })();
    return () => { alive = false; };
  }, [matchupId, week]);

  const home = data ? sideSlugs(data, 'home') : [];
  const away = data ? sideSlugs(data, 'away') : [];

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 16, overflow: 'auto' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 760, background: 'var(--bg)', border: '1px solid var(--bd)', borderLeft: '3px solid var(--you)', borderRadius: 10, padding: 16, margin: 'auto 0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <span className="mono" style={{ ...mono, fontSize: 9, letterSpacing: '0.12em', color: 'var(--faint)', fontWeight: 700 }}>
            FEED SHEET · 2025 wk {week} · per-player play log
          </span>
          <button onClick={onClose} className="mono" style={linkBtn}>✕ close</button>
        </div>
        {err && <div className="mono" style={{ ...mono, fontSize: 10.5, color: 'var(--opp)' }}>{err}</div>}
        {!ready && !err && <div className="mono" style={{ ...mono, fontSize: 10.5, color: 'var(--faint)' }}>Loading lineups + week {week} plays…</div>}
        {ready && data && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14 }}>
            {([['HOME', `roster ${data.home_roster_id}`, home], ['AWAY', `roster ${data.away_roster_id}`, away]] as const).map(([label, sub, players]) => (
              <div key={label}>
                <div className="mono" style={{ ...mono, fontSize: 9, letterSpacing: '0.1em', color: 'var(--you)', fontWeight: 700, marginBottom: 7 }}>{label} <span style={{ color: 'var(--faint)' }}>· {sub} · {players.length}</span></div>
                {players.length === 0 ? <div className="mono" style={{ ...mono, fontSize: 9.5, color: 'var(--faint)' }}>no lineup (run sync week)</div> : players.map((p) => <PlayerCard key={p.slug} p={p} week={week} />)}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
