// Admin "feed sheet": the per-player play-by-play for a real matchup's two
// lineups, PLAYED BACK as a live feed — a clock advances and each play is
// revealed as its delivery time (t+) arrives, totals counting up, exactly the
// order the live sim drips into live_play. Data is the baked source week (the
// React twin of scripts/feedlog.mjs). Pure read; reuses admin_matchup_picks.
import { useEffect, useMemo, useRef, useState } from 'react';
import { adminMatchupPicks, type MatchupPicks } from '../data/liveApi';
import { loadRealWeek, realPbpFor, realPointsFor, type RealPlay } from '../data/realPbp';
import { slugMeta } from '../data/slugMeta';
import { PlayerImg } from '../app/ui';
import type { Pos } from '../types';

const mono: React.CSSProperties = { fontFamily: 'var(--mono, monospace)' };
const linkBtn: React.CSSProperties = { background: 'none', border: 'none', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--dim)', cursor: 'pointer' };
const ctlBtn = (active = false): React.CSSProperties => ({ fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', color: active ? 'var(--on-accent, #06121a)' : 'var(--text)', background: active ? 'var(--you)' : 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 4, padding: '4px 8px', cursor: 'pointer' });

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

interface Ev { at: number; kind: string; y: number; td: boolean; d: number; cum: number; showYd: boolean }
interface PlayerFeed { slug: string; pos: Pos; team: string; total: number | null; evs: Ev[] }

/** A side's players with each play pre-rolled into a cumulative running total. */
function sideFeed(data: MatchupPicks, side: 'home' | 'away', week: number): PlayerFeed[] {
  const appUser = side === 'home' ? data.home_app_user : data.away_app_user;
  const picks = appUser ? data.picks.filter((p) => p.app_user_id === appUser && p.player_slug) : [];
  const raw = picks.length
    ? picks.map((p) => p.player_slug!)
    : ((side === 'home' ? data.home_lineup : data.away_lineup) ?? []).map((e) => e.player_slug).filter((s): s is string => !!s);
  const pts = realPointsFor(week);
  const seen = new Set<string>();
  const out: PlayerFeed[] = [];
  for (const slug of raw) {
    if (seen.has(slug)) continue;
    seen.add(slug);
    const m = slugMeta(slug);
    const plays = (realPbpFor(week, slug) ?? []).slice().sort((a, b) => (a.t ?? a.c ?? 0) - (b.t ?? b.c ?? 0));
    let cum = 0;
    const evs: Ev[] = plays.map((p) => {
      const d = delta(p); cum += d;
      return { at: p.t ?? p.c ?? 0, kind: p.k, y: p.y, td: !!p.td, d, cum: round(cum), showYd: ['pass', 'rush', 'rec', 'fg', 'return'].includes(p.k) };
    });
    out.push({ slug, pos: m.pos, team: m.team, total: pts[slug] ?? null, evs });
  }
  return out;
}

function PlayerCard({ f, clock }: { f: PlayerFeed; clock: number }) {
  // revealed plays, newest first (feed order)
  const shown = f.evs.filter((e) => e.at <= clock);
  const cur = shown.length ? shown[shown.length - 1].cum : 0;
  const rev = shown.slice().reverse();
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 7, padding: 9, marginBottom: 7 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <PlayerImg playerId={f.slug} team={f.team} pos={f.pos} size={34} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{fmtSlug(f.slug)}</div>
          <div style={{ ...mono, fontSize: 9, color: 'var(--dim)' }}>{f.pos} {f.team} · {shown.length}/{f.evs.length} plays</div>
        </div>
        <div className="grotesk" style={{ fontSize: 19, fontWeight: 800, color: 'var(--you)', lineHeight: 1, textAlign: 'right' }}>
          {round(cur)}
          <span style={{ ...mono, display: 'block', fontSize: 7.5, color: 'var(--faint)', fontWeight: 700, letterSpacing: '0.08em' }}>{f.total != null ? `of ${round(f.total)}` : 'PTS'}</span>
        </div>
      </div>
      {f.evs.length === 0
        ? <div style={{ ...mono, fontSize: 9.5, color: 'var(--faint)', marginTop: 6 }}>no baked plays this week</div>
        : rev.length === 0
          ? <div style={{ ...mono, fontSize: 9.5, color: 'var(--faint)', marginTop: 6 }}>waiting for kickoff…</div>
          : <div style={{ marginTop: 7, borderTop: '1px solid var(--bd)', paddingTop: 5, maxHeight: 150, overflow: 'auto' }}>
            {rev.map((e, i) => (
              <div key={f.evs.length - 1 - i} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto auto auto', gap: 6, alignItems: 'baseline', padding: '1.5px 0', fontSize: 10, ...mono, background: i === 0 ? 'var(--you-soft, rgba(107,209,255,0.10))' : 'transparent', borderRadius: 3 }}>
                <span style={{ color: 'var(--faint)', minWidth: 38 }}>t+{fmtClock(e.at)}</span>
                <span style={{ color: e.td ? 'var(--you)' : 'var(--dim)' }}>{KIND[e.kind] ?? e.kind}{e.td ? ' ●' : ''}</span>
                <span style={{ color: 'var(--text)', textAlign: 'right' }}>{e.showYd ? `${e.y} yd` : ''}</span>
                <span style={{ color: e.d < 0 ? 'var(--opp)' : 'var(--faint)', textAlign: 'right', minWidth: 30 }}>{e.d ? `${e.d > 0 ? '+' : ''}${round(e.d)}` : '·'}</span>
                <span style={{ color: e.td ? 'var(--you)' : 'var(--text)', fontWeight: 700, textAlign: 'right', minWidth: 34 }}>{e.cum}</span>
              </div>
            ))}
          </div>}
    </div>
  );
}

const SPEEDS = [300, 600, 1500];

export function FeedSheet({ matchupId, week, onClose }: { matchupId: string; week: number; onClose: () => void }) {
  const [data, setData] = useState<MatchupPicks | null>(null);
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [clock, setClock] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [rate, setRate] = useState(600); // game-seconds per real second
  const last = useRef<number | null>(null);

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

  const home = useMemo(() => (data ? sideFeed(data, 'home', week) : []), [data, week]);
  const away = useMemo(() => (data ? sideFeed(data, 'away', week) : []), [data, week]);
  const allEvs = useMemo(() => {
    const out: { at: number; name: string; pos: Pos; team: string; kind: string; y: number; td: boolean; d: number }[] = [];
    for (const side of [home, away]) for (const f of side) for (const e of f.evs)
      out.push({ at: e.at, name: fmtSlug(f.slug), pos: f.pos, team: f.team, kind: e.kind, y: e.y, td: e.td, d: e.d });
    return out.sort((a, b) => a.at - b.at);
  }, [home, away]);
  const maxAt = useMemo(() => allEvs.reduce((m, e) => Math.max(m, e.at), 0), [allEvs]);
  const done = ready && clock >= maxAt && maxAt > 0;

  // playback ticker (rAF-ish via interval; real elapsed × rate)
  useEffect(() => {
    if (!ready || !playing || maxAt === 0) { last.current = null; return; }
    const id = setInterval(() => {
      const now = Date.now();
      const dt = last.current == null ? 0 : (now - last.current) / 1000;
      last.current = now;
      setClock((c) => {
        const n = c + dt * rate;
        if (n >= maxAt) { setPlaying(false); return maxAt; }
        return n;
      });
    }, 80);
    return () => { clearInterval(id); last.current = null; };
  }, [ready, playing, rate, maxAt]);

  const replay = () => { setClock(0); setPlaying(true); };
  const toggle = () => { if (done) replay(); else setPlaying((p) => !p); };

  const ticker = allEvs.filter((e) => e.at <= clock).slice(-7).reverse();

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 16, overflow: 'auto' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 760, background: 'var(--bg)', border: '1px solid var(--bd)', borderLeft: '3px solid var(--you)', borderRadius: 10, padding: 16, margin: 'auto 0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <span className="mono" style={{ ...mono, fontSize: 9, letterSpacing: '0.12em', color: 'var(--faint)', fontWeight: 700 }}>
            FEED SHEET · 2025 wk {week} · {done ? <span style={{ color: 'var(--faint)' }}>FINAL</span> : <span style={{ color: 'var(--you)' }}>● LIVE</span>}
          </span>
          <button onClick={onClose} className="mono" style={linkBtn}>✕ close</button>
        </div>
        {err && <div className="mono" style={{ ...mono, fontSize: 10.5, color: 'var(--opp)' }}>{err}</div>}
        {!ready && !err && <div className="mono" style={{ ...mono, fontSize: 10.5, color: 'var(--faint)' }}>Loading lineups + week {week} plays…</div>}
        {ready && data && (
          <>
            {/* transport */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
              <button style={ctlBtn(playing)} onClick={toggle}>{done ? '↺ replay' : playing ? '⏸ pause' : '▶ play'}</button>
              {!done && <button style={ctlBtn(false)} onClick={replay} title="restart">↺</button>}
              <div style={{ display: 'flex', gap: 4 }}>
                {SPEEDS.map((s) => <button key={s} style={ctlBtn(rate === s)} onClick={() => setRate(s)}>{s === 300 ? '1×' : s === 600 ? '2×' : '5×'}</button>)}
              </div>
              <span className="mono" style={{ ...mono, fontSize: 10, color: 'var(--dim)', marginLeft: 'auto' }}>t+{fmtClock(clock)} / {fmtClock(maxAt)}</span>
            </div>
            <div style={{ height: 3, background: 'var(--bd)', borderRadius: 2, marginBottom: 10, overflow: 'hidden' }}>
              <div style={{ width: `${maxAt ? Math.min(100, (clock / maxAt) * 100) : 0}%`, height: '100%', background: 'var(--you)' }} />
            </div>
            {/* live ticker */}
            <div style={{ background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 7, padding: '6px 9px', marginBottom: 12, minHeight: 26 }}>
              {ticker.length === 0 ? <span className="mono" style={{ ...mono, fontSize: 10, color: 'var(--faint)' }}>waiting for the first play…</span> : ticker.map((e, i) => (
                <div key={i} className="mono" style={{ ...mono, fontSize: 10, color: i === 0 ? 'var(--text)' : 'var(--faint)', display: 'flex', gap: 6, padding: '1px 0', opacity: i === 0 ? 1 : 0.7 }}>
                  <span style={{ color: 'var(--faint)', minWidth: 40 }}>t+{fmtClock(e.at)}</span>
                  <span style={{ color: e.td ? 'var(--you)' : 'var(--text)', fontWeight: 700 }}>{e.name}</span>
                  <span style={{ color: 'var(--dim)' }}>{KIND[e.kind] ?? e.kind}{['pass', 'rush', 'rec', 'fg', 'return'].includes(e.kind) ? ` ${e.y}yd` : ''}{e.td ? ' TD' : ''}</span>
                  {e.d ? <span style={{ color: e.d < 0 ? 'var(--opp)' : 'var(--you)', marginLeft: 'auto' }}>{e.d > 0 ? '+' : ''}{round(e.d)}</span> : null}
                </div>
              ))}
            </div>
            {/* per-player cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14 }}>
              {([['HOME', `roster ${data.home_roster_id}`, home], ['AWAY', `roster ${data.away_roster_id}`, away]] as const).map(([label, sub, players]) => (
                <div key={label}>
                  <div className="mono" style={{ ...mono, fontSize: 9, letterSpacing: '0.1em', color: 'var(--you)', fontWeight: 700, marginBottom: 7 }}>{label} <span style={{ color: 'var(--faint)' }}>· {sub} · {players.length}</span></div>
                  {players.length === 0 ? <div className="mono" style={{ ...mono, fontSize: 9.5, color: 'var(--faint)' }}>no lineup (run sync week)</div> : players.map((f) => <PlayerCard key={f.slug} f={f} clock={clock} />)}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
