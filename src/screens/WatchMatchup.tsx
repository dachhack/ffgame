// ONE CONTEST MATCHUP, FOR ANYONE WITH THE LINK (v0.730.26) — #/watch/<id>.
// Founder: "can we make a link to show the one match up in that league on a
// website for anyone not logged in? It's deciding a tie in one of my leagues
// and other league mates might want to follow it." No sign-in: the page reads
// public_contest_matchup (0513), which hands out the matchup as an outsider
// sees it — each pick sealed until its player kicks off — and refreshes every
// minute. Read only; the app's own matchup stays the place to play.
import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../app/store';
import { Brand } from '../app/ui';
import { publicContestMatchup, type PublicContestMatchup } from '@drip/core/data/liveApi';
import { contestSlotLabels, contestPlayById } from '@drip/core/engine/contest';
import { classicSlotsFromSpec } from '@drip/core/engine/classic';

const fmt = (n: number | null | undefined) => (n == null ? '—' : Number(n).toFixed(1));

export function WatchMatchup({ matchupId }: { matchupId: string }) {
  const { navigate } = useStore();
  const [m, setM] = useState<PublicContestMatchup | null>(null);
  useEffect(() => {
    let dead = false;
    const read = () => publicContestMatchup(matchupId).then((r) => { if (!dead) setM(r); }).catch(() => {});
    void read();
    const id = setInterval(read, 60_000);
    return () => { dead = true; clearInterval(id); };
  }, [matchupId]);
  const slots = useMemo(() => classicSlotsFromSpec((m?.slots ?? null) as never) ?? [], [m?.slots]);
  const labels = useMemo(() => contestSlotLabels(slots), [slots]);

  const shell = (body: React.ReactNode) => (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)' }}>
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '16px 16px 48px' }}>
        <Brand onClick={() => navigate({ name: 'landing' })} hideDataSource />
        {body}
      </div>
    </div>
  );
  if (!m) return shell(<div className="mono" style={{ marginTop: 24, fontSize: 12, color: 'var(--faint)' }}>Loading the matchup…</div>);
  if (!m.ok) return shell(<div className="mono" style={{ marginTop: 24, fontSize: 12, color: 'var(--faint)' }}>{m.error ?? 'This matchup isn’t available.'}</div>);

  const final = m.status === 'final';
  const total = (s: 'home' | 'away') => final ? (s === 'home' ? m.home_final : m.away_final) : m.state ? m.state[s] : null;
  const scoreOf = (s: 'home' | 'away', slot: string) => m.state?.slots?.find((x) => x.side === s && x.slot === slot) ?? null;
  const entryOf = (s: 'home' | 'away', slot: string) => (s === 'home' ? m.home_entry : m.away_entry)?.find((e) => e.slot === slot) ?? null;
  const playOf = (s: 'home' | 'away', slot: string) => (s === 'home' ? m.home_plays : m.away_plays)?.find((p) => p.slot === slot) ?? null;
  const squadPlays = (s: 'home' | 'away') => ((s === 'home' ? m.home_plays : m.away_plays) ?? []).filter((p) => !p.slot);
  const solo = !m.away_entry;
  const status = final ? 'FINAL' : m.started ? '● LIVE' : 'BEFORE KICKOFF';

  const cell = (s: 'home' | 'away', slot: string, right: boolean) => {
    const e = entryOf(s, slot);
    const sc = scoreOf(s, slot);
    const pl = playOf(s, slot);
    const p = e?.player_slug ? m.names?.[e.player_slug] : null;
    const name = e?.sealed ? '◈ sealed' : p ? p.name : e?.player_slug ? e.player_slug : '—';
    return (
      <div style={{ flex: 1, minWidth: 0, textAlign: right ? 'right' : 'left' }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: e?.sealed ? 'var(--faint)' : 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {pl && !right && <span title={contestPlayById(pl.id)?.name ?? pl.id} style={{ marginRight: 4 }}>{contestPlayById(pl.id)?.icon ?? '⚡'}</span>}
          {name}
          {pl && right && <span title={contestPlayById(pl.id)?.name ?? pl.id} style={{ marginLeft: 4 }}>{contestPlayById(pl.id)?.icon ?? '⚡'}</span>}
        </div>
        <div className="mono" style={{ fontSize: 10.5, color: 'var(--faint)' }}>
          {e?.sealed ? 'until his kickoff' : p ? `${p.pos} · ${p.team}${!m.started ? ` · (${fmt(p.proj)})` : ''}` : ''}
        </div>
        <div className="mono" style={{ fontSize: 18, fontWeight: 800, marginTop: 2, color: sc ? 'var(--text)' : 'var(--faint)' }}>
          {sc ? fmt(sc.score) : ''}
          {sc?.raw != null && Math.abs(sc.raw - sc.score) > 1e-9 && <span style={{ fontSize: 10.5, fontWeight: 700, marginLeft: 6, color: 'var(--faint)', textDecoration: 'line-through' }}>{fmt(sc.raw)}</span>}
        </div>
      </div>
    );
  };

  return shell(
    <div style={{ marginTop: 16 }}>
      <div className="mono" style={{ fontSize: 11, letterSpacing: '0.12em', color: 'var(--faint)' }}>{`${(m.league ?? '').toUpperCase()} · WEEK ${m.week}${m.label ? ` · ${m.label.toUpperCase()}` : ''}`}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10, padding: '14px 16px', border: '1px solid var(--bd)', borderRadius: 10, background: 'var(--surface)' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.home_team}</div>
          <div className="mono" style={{ fontSize: 28, fontWeight: 800, color: 'var(--you)' }}>{fmt(total('home'))}</div>
          {squadPlays('home').map((p) => <div key={p.id} className="mono" style={{ fontSize: 10.5, color: 'var(--faint)' }}>{`${contestPlayById(p.id)?.icon ?? '⚡'} ${contestPlayById(p.id)?.name ?? p.id}`}</div>)}
        </div>
        <div className="mono" style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.1em', color: m.started && !final ? 'var(--opp)' : 'var(--faint)' }}>{status}</div>
        {!solo && (
          <div style={{ flex: 1, minWidth: 0, textAlign: 'right' }}>
            <div style={{ fontSize: 15, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.away_team}</div>
            <div className="mono" style={{ fontSize: 28, fontWeight: 800, color: 'var(--opp)' }}>{fmt(total('away'))}</div>
            {squadPlays('away').map((p) => <div key={p.id} className="mono" style={{ fontSize: 10.5, color: 'var(--faint)' }}>{`${contestPlayById(p.id)?.icon ?? '⚡'} ${contestPlayById(p.id)?.name ?? p.id}`}</div>)}
          </div>
        )}
      </div>
      <div style={{ marginTop: 12 }}>
        {slots.map((d) => (
          <div key={d.slot} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 4px', borderBottom: '1px solid var(--bd)' }}>
            {cell('home', d.slot, false)}
            <div className="mono" style={{ width: 56, flex: 'none', textAlign: 'center', fontSize: 10.5, fontWeight: 700, color: 'var(--dim)' }}>{labels[d.slot] ?? d.slot}</div>
            {!solo ? cell('away', d.slot, true) : <div style={{ flex: 1 }} />}
          </div>
        ))}
      </div>
      <div className="mono" style={{ marginTop: 14, fontSize: 10.5, color: 'var(--faint)', textAlign: 'center' }}>
        Updates every minute · picks show as each player kicks off
      </div>
    </div>
  );
}
