// HEROES & VILLAINS (v0.632.0) — the My Leagues page's rooting guide, the
// app's twin (apps/mobile/src/ui/HeroesVillains.tsx). Folded from the glance
// snapshots the page already reads (core heroes.ts): heroes, villains, the
// key games by stake, and a quad box per multi-game window.
import { useMemo, useState } from 'react';
import type { WidgetSnapshot } from '@drip/core/data/widgetFeed';
import { heroesVillains, type StakePlayer, type KeyGame } from '@drip/core/data/heroes';
import { weekTitle } from '@drip/core/data/nflSlate';

type Tab = 'heroes' | 'villains' | 'games' | 'quad';
const fmtKick = (ms: number | null) => (ms == null ? 'TBD'
  : new Intl.DateTimeFormat('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }).format(new Date(ms)).replace(' ', '').replace(/(AM|PM)/, (m) => m[0].toLowerCase()));
const num = (p: StakePlayer) => (p.status !== 'pre' && p.pts != null ? `${p.status === 'live' ? '● ' : ''}${p.pts.toFixed(1)}` : p.proj != null ? `P ${p.proj.toFixed(1)}` : '');
const pill = (on: boolean): React.CSSProperties => ({
  padding: '4px 10px', borderRadius: 999, border: `1px solid ${on ? 'var(--you)' : 'var(--bd)'}`, background: on ? 'color-mix(in srgb, var(--you) 14%, transparent)' : 'transparent',
  color: on ? 'var(--you)' : 'var(--dim)', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', cursor: 'pointer',
});

export function HeroesVillains({ snaps }: { snaps: WidgetSnapshot[] }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('heroes');
  const hv = useMemo(() => heroesVillains(snaps), [snaps]);
  if (hv.week == null || hv.leagues === 0 || (!hv.heroes.length && !hv.villains.length)) return null;
  const summary = `${hv.heroes.length} hero${hv.heroes.length === 1 ? '' : 'es'} · ${hv.villains.length} villain${hv.villains.length === 1 ? '' : 's'} · ${hv.games.length} key game${hv.games.length === 1 ? '' : 's'}${hv.sealed ? ` · ${hv.sealed} sealed` : ''}`;

  const player = (p: StakePlayer, side: 'hero' | 'villain') => {
    const other = side === 'hero' ? p.villainIn.length : p.heroIn.length;
    const inList = side === 'hero' ? p.heroIn : p.villainIn;
    const tone = side === 'hero' ? 'var(--you)' : 'var(--opp)';
    return (
      <div key={p.slug} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderTop: '1px solid var(--bd)' }}>
        <span className="mono" style={{ minWidth: 26, textAlign: 'center', background: `color-mix(in srgb, ${tone} 16%, transparent)`, color: tone, borderRadius: 6, padding: '2px 5px', fontSize: 12, fontWeight: 700 }}>×{p.count}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {p.name} <span className="mono" style={{ fontSize: 10.5, color: 'var(--faint)', fontWeight: 400 }}>{[p.pos, p.team].filter(Boolean).join(' · ')}</span>
          </div>
          <div className="mono" style={{ fontSize: 10, color: 'var(--faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {inList.map((l) => (side === 'hero' ? l.leagueName : `${l.leagueName} (${l.opponent})`)).join(', ')}{other ? ` · also ${side === 'hero' ? 'a villain' : 'a hero'} in ${other}` : ''}
          </div>
        </div>
        <span className="mono" style={{ fontSize: 12, fontWeight: 700, color: p.status === 'live' ? 'var(--text)' : p.status === 'final' ? 'var(--you)' : 'var(--dim)' }}>{num(p)}</span>
      </div>
    );
  };
  const game = (g: KeyGame, i: number) => (
    <div key={g.key} style={{ padding: '6px 0', borderTop: '1px solid var(--bd)', display: 'grid', gap: 2 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="mono" style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--faint)', width: 16 }}>{i + 1}</span>
        <span className="mono" style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', flex: 1 }}>{g.away} @ {g.home}</span>
        <span className="mono" style={{ fontSize: 10.5, fontWeight: 700, color: g.status === 'live' ? 'var(--opp)' : 'var(--faint)' }}>{g.status === 'live' ? '● LIVE' : g.status === 'final' ? 'FINAL' : fmtKick(g.kickoff)}</span>
        <span className="mono" style={{ fontSize: 11, fontWeight: 700, color: 'var(--you)', background: 'color-mix(in srgb, var(--you) 14%, transparent)', borderRadius: 6, padding: '2px 6px' }}>{g.stake} at stake</span>
      </div>
      {(g.heroes.length > 0 || g.villains.length > 0) && (
        <div className="mono" style={{ fontSize: 10.5, lineHeight: 1.45, color: 'var(--dim)', marginLeft: 24 }}>
          {g.heroes.length ? <span style={{ color: 'var(--you)' }}>👍 {g.heroes.map((p) => `${p.name}${p.count > 1 ? ` ×${p.count}` : ''}`).join(', ')}</span> : null}
          {g.heroes.length && g.villains.length ? <span>   </span> : null}
          {g.villains.length ? <span style={{ color: 'var(--opp)' }}>👎 {g.villains.map((p) => `${p.name}${p.count > 1 ? ` ×${p.count}` : ''}`).join(', ')}</span> : null}
        </div>
      )}
    </div>
  );

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 10, padding: '10px 12px', display: 'grid', gap: 8, marginBottom: 12 }}>
      <button onClick={() => setOpen((o) => !o)} style={{ all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>Heroes & villains <span className="mono" style={{ fontSize: 10.5, color: 'var(--faint)', fontWeight: 400 }}>{weekTitle(hv.week)}</span></div>
          <div className="mono" style={{ fontSize: 9.5, color: 'var(--faint)' }}>{summary}</div>
        </div>
        <span className="mono" style={{ fontSize: 14, color: 'var(--dim)' }}>{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            <button className="mono" style={pill(tab === 'heroes')} onClick={() => setTab('heroes')}>HEROES {hv.heroes.length}</button>
            <button className="mono" style={pill(tab === 'villains')} onClick={() => setTab('villains')}>VILLAINS {hv.villains.length}</button>
            <button className="mono" style={pill(tab === 'games')} onClick={() => setTab('games')}>KEY GAMES {hv.games.length}</button>
            <button className="mono" style={pill(tab === 'quad')} onClick={() => setTab('quad')}>QUAD BOX</button>
          </div>
          {tab === 'heroes' && (
            <div>
              <div className="mono" style={{ fontSize: 9.5, color: 'var(--faint)' }}>Your starters across {hv.leagues} matchup{hv.leagues === 1 ? '' : 's'}. ×N is how many of your matchups he starts for you.</div>
              {hv.heroes.slice(0, 40).map((p) => player(p, 'hero'))}
            </div>
          )}
          {tab === 'villains' && (
            <div>
              <div className="mono" style={{ fontSize: 9.5, color: 'var(--faint)' }}>Starting against you. ×N is how many of your opponents start him.{hv.sealed ? ` ${hv.sealed} drip slot${hv.sealed === 1 ? '' : 's'} still sealed until kickoff.` : ''}</div>
              {hv.villains.length === 0 && <div className="mono" style={{ fontSize: 10.5, color: 'var(--faint)', marginTop: 6 }}>No villains revealed yet.</div>}
              {hv.villains.slice(0, 40).map((p) => player(p, 'villain'))}
            </div>
          )}
          {tab === 'games' && (
            <div>
              <div className="mono" style={{ fontSize: 9.5, color: 'var(--faint)' }}>Ranked by how many of your matchups each game touches.</div>
              {hv.games.slice(0, 16).map(game)}
            </div>
          )}
          {tab === 'quad' && (
            <div style={{ display: 'grid', gap: 8 }}>
              <div className="mono" style={{ fontSize: 9.5, color: 'var(--faint)' }}>For each window with several games: the four screens to put up.</div>
              {hv.quads.length === 0 && <div className="mono" style={{ fontSize: 10.5, color: 'var(--faint)' }}>No window this week has more than one game.</div>}
              {hv.quads.map((q) => (
                <div key={q.win} style={{ display: 'grid', gap: 2 }}>
                  <div className="mono" style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--you)' }}>{q.label.toUpperCase()}{q.others ? ` · +${q.others} more game${q.others === 1 ? '' : 's'}` : ''}</div>
                  {q.games.map(game)}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
