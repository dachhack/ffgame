// THE PREVIEW (v0.718.0; HEROES & VILLAINS since v0.632.0) — the web's twin
// of apps/mobile/src/ui/HeroesVillains.tsx, opened in the league tools bar's
// sheet. Folded from the glance snapshots the page already reads (core
// heroes.ts): heroes and villains with their faces, the key games as counts
// (tap for the players), and a quad box per multi-game window showing the two
// players who matter most a side (tap for everyone). One tab row that never
// wraps; what each tab is lives in its ⓘ.
import { useMemo, useState } from 'react';
import type { WidgetSnapshot } from '@drip/core/data/widgetFeed';
import { heroesVillains, gameFaces, gameCounts, previewList, injuryTag, PREVIEW_INFO, type StakePlayer, type KeyGame } from '@drip/core/data/heroes';
import { InfoChip } from './adminUi';

type Tab = 'heroes' | 'villains' | 'games' | 'quad';
const fmtKick = (ms: number | null) => (ms == null ? 'TBD'
  : new Intl.DateTimeFormat('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }).format(new Date(ms)).replace(' ', '').replace(/(AM|PM)/, (m) => m[0].toLowerCase()));
const num = (p: StakePlayer) => (p.status !== 'pre' && p.pts != null ? `${p.status === 'live' ? '● ' : ''}${p.pts.toFixed(1)}` : p.proj != null ? `P ${p.proj.toFixed(1)}` : '');
const initials = (name: string) => name.split(/\s+/).map((w) => w[0] ?? '').join('').slice(0, 2).toUpperCase();
const seg = (on: boolean): React.CSSProperties => ({
  flex: '1 1 0', minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textAlign: 'center',
  padding: '5px 4px', borderRadius: 999, border: `1px solid ${on ? 'var(--you)' : 'var(--bd)'}`, background: on ? 'color-mix(in srgb, var(--you) 14%, transparent)' : 'transparent',
  color: on ? 'var(--you)' : 'var(--dim)', fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', cursor: 'pointer',
});
const row: React.CSSProperties = { all: 'unset', cursor: 'pointer', display: 'grid', gap: 3, padding: '7px 0', borderTop: '1px solid var(--bd)' };

export function HeroesVillains({ snaps }: { snaps: WidgetSnapshot[] }) {
  const [tab, setTab] = useState<Tab>('heroes');
  const [shown, setShown] = useState<string | null>(null);
  const hv = useMemo(() => heroesVillains(snaps), [snaps]);
  // v0.723.0: everyone at 2x or more, topped up to five with the best 1x.
  const heroes = useMemo(() => previewList(hv.heroes), [hv]);
  const villains = useMemo(() => previewList(hv.villains), [hv]);
  if (hv.week == null || hv.leagues === 0 || (!hv.heroes.length && !hv.villains.length)) {
    return <div className="mono" style={{ fontSize: 11, color: 'var(--faint)' }}>Nothing to preview yet — no lineups this week.</div>;
  }

  // INJURY STATUS (v0.723.0): the designation, in the warning colour.
  const inj = (tag: string | null | undefined) => (injuryTag(tag)
    ? <span className="mono" style={{ fontSize: 10, fontWeight: 800, color: 'var(--warn)' }}>{` ${injuryTag(tag)}`}</span> : null);
  const face = (p: StakePlayer, side: 'hero' | 'villain', size = 30) => {
    const tone = side === 'hero' ? 'var(--you)' : 'var(--opp)';
    return (
      <span style={{ flex: 'none', width: size, height: size, borderRadius: '50%', overflow: 'hidden', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: `1.5px solid ${tone}`, background: `color-mix(in srgb, ${tone} 16%, transparent)` }}>
        {p.image
          ? <img src={p.image} alt="" width={size} height={size} style={{ objectFit: 'cover', width: size, height: size }} />
          : <span className="mono" style={{ fontSize: size * 0.34, fontWeight: 700, color: tone }}>{initials(p.name)}</span>}
      </span>
    );
  };
  const player = (p: StakePlayer, side: 'hero' | 'villain', leagues = true) => {
    const other = side === 'hero' ? p.villainIn.length : p.heroIn.length;
    const inList = side === 'hero' ? p.heroIn : p.villainIn;
    const tone = side === 'hero' ? 'var(--you)' : 'var(--opp)';
    return (
      <div key={`${side}:${p.slug}`} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderTop: '1px solid var(--bd)' }}>
        {face(p, side)}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {p.name} <span className="mono" style={{ fontSize: 10.5, color: 'var(--faint)', fontWeight: 400 }}>{[p.pos, p.team].filter(Boolean).join(' · ')}</span>{inj(p.injury)}
          </div>
          {leagues && (
            <div className="mono" style={{ fontSize: 10, color: 'var(--faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {inList.map((l) => (side === 'hero' ? l.leagueName : `${l.leagueName} (${l.opponent})`)).join(', ')}{other ? ` · also ${side === 'hero' ? 'a villain' : 'a hero'} in ${other}` : ''}
            </div>
          )}
        </div>
        <span className="mono" style={{ fontSize: 11, fontWeight: 700, color: tone }}>×{p.count}</span>
        <span className="mono" style={{ fontSize: 12, fontWeight: 700, minWidth: 44, textAlign: 'right', color: p.status === 'live' ? 'var(--text)' : p.status === 'final' ? 'var(--you)' : 'var(--dim)' }}>{num(p)}</span>
      </div>
    );
  };
  const head = (g: KeyGame, lead: string) => (
    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span className="mono" style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--faint)', minWidth: 16 }}>{lead}</span>
      <span className="mono" style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', flex: 1 }}>{g.away} @ {g.home}</span>
      <span className="mono" style={{ fontSize: 10.5, fontWeight: 700, color: g.status === 'live' ? 'var(--opp)' : 'var(--faint)' }}>{g.status === 'live' ? '● LIVE' : g.status === 'final' ? 'FINAL' : fmtKick(g.kickoff)}</span>
    </span>
  );
  const all = (g: KeyGame) => (
    <span style={{ display: 'block', marginTop: 4 }}>
      {g.heroes.map((p) => player(p, 'hero', false))}
      {g.villains.map((p) => player(p, 'villain', false))}
    </span>
  );
  const toggle = (k: string) => setShown((s) => (s === k ? null : k));
  // KEY GAMES: the counts; click for the players.
  const game = (g: KeyGame, i: number) => {
    const open = shown === g.key;
    return (
      <div key={g.key} role="button" tabIndex={0} onClick={() => toggle(g.key)} style={row}>
        {head(g, String(i + 1))}
        <span className="mono" style={{ display: 'flex', gap: 8, marginLeft: 24, fontSize: 11, fontWeight: 700 }}>
          <span style={{ flex: 1 }}>
            {g.heroes.length ? <span style={{ color: 'var(--you)' }}>{`${g.heroes.length} yours`}</span> : null}
            {g.heroes.length && g.villains.length ? <span style={{ color: 'var(--faint)' }}> · </span> : null}
            {g.villains.length ? <span style={{ color: 'var(--opp)' }}>{`${g.villains.length} theirs`}</span> : null}
            {!g.heroes.length && !g.villains.length ? <span style={{ color: 'var(--faint)' }}>{gameCounts(g)}</span> : null}
          </span>
          <span style={{ color: 'var(--dim)', fontWeight: 400 }}>{open ? '▴' : '▾'}</span>
        </span>
        {open && all(g)}
      </div>
    );
  };
  // QUAD BOX: the two who matter most a side; click for everyone.
  const quadGame = (g: KeyGame, i: number) => {
    const open = shown === g.key;
    const f = gameFaces(g);
    const mini = (p: StakePlayer, side: 'hero' | 'villain') => (
      <span key={`${side}:${p.slug}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, minWidth: 0, maxWidth: '48%' }}>
        {face(p, side, 22)}
        <span className="mono" style={{ fontSize: 10.5, color: side === 'hero' ? 'var(--you)' : 'var(--opp)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{`${p.name}${p.count > 1 ? ` ×${p.count}` : ''}`}{inj(p.injury)}</span>
      </span>
    );
    return (
      <div key={g.key} role="button" tabIndex={0} onClick={() => toggle(g.key)} style={row}>
        {head(g, String(i + 1))}
        {open ? all(g) : (f.mine.length || f.theirs.length) ? (
          <span style={{ display: 'grid', gap: 4, marginLeft: 24 }}>
            {f.mine.length > 0 && <span style={{ display: 'flex', gap: 8 }}>{f.mine.map((p) => mini(p, 'hero'))}</span>}
            {f.theirs.length > 0 && <span style={{ display: 'flex', gap: 8 }}>{f.theirs.map((p) => mini(p, 'villain'))}</span>}
            {f.more > 0 && <span className="mono" style={{ fontSize: 10, color: 'var(--faint)' }}>{`+${f.more} more ▾`}</span>}
          </span>
        ) : <span className="mono" style={{ fontSize: 10.5, color: 'var(--faint)', marginLeft: 24 }}>nobody of yours</span>}
      </div>
    );
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: 'heroes', label: `HEROES ${heroes.length}` },
    { id: 'villains', label: `VILLAINS ${villains.length}` },
    { id: 'games', label: `KEY GAMES ${hv.games.length}` },
    { id: 'quad', label: 'QUAD BOX' },
  ];
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'nowrap' }}>
        {tabs.map((x) => <button key={x.id} className="mono" style={seg(tab === x.id)} onClick={() => { setTab(x.id); setShown(null); }}>{x.label}</button>)}
        <InfoChip title="Preview" info={PREVIEW_INFO} />
      </div>
      {tab === 'heroes' && <div>{heroes.map((p) => player(p, 'hero'))}</div>}
      {tab === 'villains' && (
        <div>
          {hv.villains.length === 0 && <div className="mono" style={{ fontSize: 10.5, color: 'var(--faint)' }}>No villains revealed yet.</div>}
          {villains.map((p) => player(p, 'villain'))}
          {hv.sealed > 0 && <div className="mono" style={{ fontSize: 10, color: 'var(--faint)', marginTop: 6 }}>{`${hv.sealed} sealed`}</div>}
        </div>
      )}
      {tab === 'games' && <div>{hv.games.slice(0, 16).map(game)}</div>}
      {tab === 'quad' && (
        <div style={{ display: 'grid', gap: 10 }}>
          {hv.quads.length === 0 && <div className="mono" style={{ fontSize: 10.5, color: 'var(--faint)' }}>No window this week has more than one game.</div>}
          {hv.quads.map((q) => (
            <div key={q.win} style={{ display: 'grid', gap: 2 }}>
              <div className="mono" style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--you)' }}>{q.label.toUpperCase()}{q.others ? ` · +${q.others} more game${q.others === 1 ? '' : 's'}` : ''}</div>
              {q.games.map(quadGame)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
