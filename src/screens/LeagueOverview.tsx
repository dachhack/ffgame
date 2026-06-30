import { useState, type ReactNode } from 'react';
import { useStore } from '../app/store';
import { Brand, Header, SiteSettings, UserChip, Avatar, PlayerImg, DemoControls } from '../app/ui';
import { getTeam, teamRoster, gameForTeam, teamResults } from '../data/league';
import { TOTAL_SLOTS } from '../data/metrics';
import { POWERUPS } from '../data/powerups';
import { avatarUrl } from '../data/media';
import { SLEEPER_HANDLE } from '../config';
import { weekLockLabel } from '../data/nflSlate';
import { APP_VERSION, DATA_SOURCE } from '../app/version';
import type { FantasyTeam } from '../types';

type ModalState =
  | null
  | { type: 'roster'; teamId: string }
  | { type: 'schedule' }
  | { type: 'shop' };

export function LeagueOverview() {
  const { navigate, coins, youTeamId: YOU, demoWeek, activeLeague: LEAGUE_REF, sleeperUser, applied } = useStore();
  // Real saved-lineup count for the week (was a hardcoded 0/8, which read as
  // "your lineup got wiped" after you'd actually set it).
  const slotsSet = Object.values(applied[demoWeek]?.lineup ?? {}).filter((p) => p.playerId).length;
  const [modal, setModal] = useState<ModalState>(null);
  const teams = [...LEAGUE_REF.teams].sort((a, b) => a.seed - b.seed);
  const you = getTeam(YOU)!;
  const wk = gameForTeam(YOU, demoWeek)!;
  const opp = getTeam(wk.oppId)!;
  const form = teamResults(YOU).filter((r) => r.week < demoWeek).slice(-5);

  return (
    <>
      <Header
        left={
          <>
            <Brand onClick={() => navigate({ name: 'hub' })} />
            <SiteSettings />
            <button
              onClick={() => navigate({ name: 'hub' })}
              className="mono"
              style={{ background: 'var(--surface)', border: '1px solid var(--bd)', color: 'var(--dim)', fontSize: 9, letterSpacing: '0.12em', padding: '6px 9px', borderRadius: 4 }}
            >
              ← ALL LEAGUES
            </button>
          </>
        }
        right={<UserChip handle={sleeperUser?.username ?? SLEEPER_HANDLE} sub="VIA SLEEPER" />}
      />
      <main style={{ flex: 1, overflow: 'auto', padding: '22px 18px 60px' }}>
        <div style={{ maxWidth: 1080, margin: '0 auto' }}>
          {/* identity row */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 18, flexWrap: 'wrap', marginBottom: 18 }}>
            <div>
              <div className="mono" style={{ fontSize: 10, letterSpacing: '0.16em', color: 'var(--faint)' }}>{LEAGUE_REF.format.toUpperCase()}</div>
              <div className="grotesk" style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text)' }}>{LEAGUE_REF.name}</div>
            </div>
            <div style={{ display: 'flex', gap: 22 }}>
              <Stat label="SEED" value={`#${you.seed}`} />
              <Stat label="RECORD" value={`${you.wins}-${you.losses}`} />
              <Stat label="POINTS FOR" value={you.pf.toFixed(0)} />
              <Stat label="◈ DRIP COIN" value={`${coins}`} />
            </div>
          </div>

          {/* demo: assume any team, jump to any week */}
          <div style={{ marginBottom: 16 }}><DemoControls /></div>

          {/* toolbar */}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
            <ToolButton onClick={() => setModal({ type: 'schedule' })}>📅 ALL MATCHUPS</ToolButton>
            <ToolButton onClick={() => setModal({ type: 'shop' })}>🛒 POWER-UP SHOP</ToolButton>
            <span style={{ fontSize: 11, color: 'var(--faint)' }}>Tap any team in standings to see their roster &amp; schedule.</span>
          </div>

          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
            {/* left: this-week matchup + form */}
            <div style={{ flex: '1.3 1 300px', minWidth: 300, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ background: 'var(--surface)', border: '1px solid var(--bd)', borderLeft: '3px solid var(--warn)', borderRadius: 6, padding: 18 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span className="grotesk" style={{ fontSize: 14, fontWeight: 700, letterSpacing: '0.04em', color: 'var(--text)' }}>WEEK {demoWeek} MATCHUP</span>
                  <span className="mono" style={{ fontSize: 9, color: 'var(--warn)', letterSpacing: '0.1em' }}>OPEN</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '14px 0' }}>
                  <TeamMini team={you} accent="var(--you)" />
                  <span className="mono" style={{ fontSize: 10, color: 'var(--faint)' }}>VS</span>
                  <TeamMini team={opp} accent="var(--opp)" right />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 12, borderTop: '1px solid var(--bd)' }}>
                  <span className="mono" style={{ fontSize: 10, color: 'var(--dim)' }}>{slotsSet}/{TOTAL_SLOTS} SLOTS SET · LOCKS {weekLockLabel(demoWeek)}</span>
                  <button
                    onClick={() => navigate({ name: 'matchup', week: demoWeek, phase: 'setup' })}
                    className="mono"
                    style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--on-accent)', background: 'var(--you)', padding: '8px 13px', borderRadius: 4, border: 'none', boxShadow: '0 0 18px color-mix(in srgb, var(--you) 28%, transparent)' }}
                  >
                    SET MATCHUP →
                  </button>
                </div>
              </div>

              <div style={{ background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 6, padding: '14px 18px' }}>
                <div className="mono" style={{ fontSize: 9, letterSpacing: '0.16em', color: 'var(--faint)', marginBottom: 10 }}>YOUR LAST {form.length}</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {form.map((r) => {
                    const won = r.result === 'W';
                    const c = won ? 'var(--you)' : r.result === 'L' ? 'var(--opp)' : 'var(--dim)';
                    return (
                      <div key={r.week} style={{ flex: '1 1 70px', border: `1px solid ${c}`, borderRadius: 4, padding: '7px 8px', textAlign: 'center' }}>
                        <div className="grotesk" style={{ fontSize: 14, fontWeight: 700, color: c }}>{r.result}</div>
                        <div className="mono" style={{ fontSize: 8.5, color: 'var(--dim)', marginTop: 2 }}>{r.ptsFor.toFixed(0)}–{r.ptsAgainst.toFixed(0)}</div>
                        <div className="mono" style={{ fontSize: 8, color: 'var(--faint)', marginTop: 1 }}>WK{r.week}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* right: standings */}
            <div style={{ flex: '2 1 360px', minWidth: 320 }}>
              <div style={{ background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 6, overflow: 'hidden' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '28px 1fr 56px 64px 48px', gap: 6, padding: '10px 14px', borderBottom: '1px solid var(--bd)' }}>
                  {['#', 'TEAM', 'REC', 'PF', 'STRK'].map((h, i) => (
                    <span key={h} className="mono" style={{ fontSize: 8.5, letterSpacing: '0.12em', color: 'var(--faint)', textAlign: i >= 2 ? 'right' : 'left' }}>{h}</span>
                  ))}
                </div>
                {teams.map((t) => {
                  const isYou = t.id === YOU;
                  const last = teamResults(t.id).filter((r) => r.week < demoWeek).slice(-1)[0];
                  const strk = last?.result ?? '—';
                  const playoff = t.seed <= 4;
                  return (
                    <button
                      key={t.id}
                      onClick={() => setModal({ type: 'roster', teamId: t.id })}
                      style={{
                        width: '100%', display: 'grid', gridTemplateColumns: '28px 1fr 56px 64px 48px', gap: 6, alignItems: 'center',
                        padding: '9px 14px', borderBottom: '1px solid var(--bd)', textAlign: 'left',
                        background: isYou ? 'color-mix(in srgb, var(--you) 7%, transparent)' : 'transparent', border: 'none', color: 'var(--text)',
                      }}
                    >
                      <span className="mono" style={{ fontSize: 11, color: playoff ? 'var(--warn)' : 'var(--faint)' }}>{t.seed}</span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                        <Avatar name={t.name} accent={isYou ? 'var(--you)' : 'var(--dim)'} size={22} src={avatarUrl(t.ownerId)} />
                        <span className="grotesk" style={{ fontSize: 12.5, fontWeight: 700, color: isYou ? 'var(--you)' : 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
                        {isYou && <span className="mono" style={{ fontSize: 8, color: 'var(--on-accent)', background: 'var(--you)', padding: '1px 4px', borderRadius: 2, letterSpacing: '0.1em' }}>YOU</span>}
                      </span>
                      <span className="mono" style={{ fontSize: 11, color: 'var(--mid)', textAlign: 'right' }}>{t.wins}-{t.losses}</span>
                      <span className="mono" style={{ fontSize: 11, color: 'var(--mid)', textAlign: 'right' }}>{t.pf.toFixed(0)}</span>
                      <span className="mono" style={{ fontSize: 11, fontWeight: 700, color: strk === 'W' ? 'var(--you)' : strk === 'L' ? 'var(--opp)' : 'var(--faint)', textAlign: 'right' }}>{strk}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* attribution */}
          <div className="mono" style={{ marginTop: 30, paddingTop: 14, borderTop: '1px solid var(--bd)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', fontSize: 9.5, color: 'var(--faint)', letterSpacing: '0.04em' }}>
            <span>
              Player stats, injuries &amp; 2025 NFL play-by-play built off{' '}
              <a href={DATA_SOURCE.url} target="_blank" rel="noreferrer" style={{ color: 'var(--you)', fontWeight: 700, textDecoration: 'none' }}>{DATA_SOURCE.name} ↗</a>.
            </span>
            <span>Drip Fantasy {APP_VERSION}</span>
          </div>
        </div>
      </main>

      {modal?.type === 'roster' && <TeamModal teamId={modal.teamId} onClose={() => setModal(null)} onOpenTeam={(id) => setModal({ type: 'roster', teamId: id })} />}
      {modal?.type === 'schedule' && <ScheduleModal onClose={() => setModal(null)} onOpenTeam={(id) => setModal({ type: 'roster', teamId: id })} />}
      {modal?.type === 'shop' && <ShopModal onClose={() => setModal(null)} />}
    </>
  );
}

export function ShopModal({ onClose }: { onClose: () => void }) {
  const { coins, inventory, buyPowerup } = useStore();
  const [flash, setFlash] = useState<string | null>(null);
  function buy(id: string) {
    if (buyPowerup(id)) { setFlash(id); setTimeout(() => setFlash((f) => (f === id ? null : f)), 600); }
  }
  return (
    <Modal title="Power-Up Shop" sub={`◈ ${coins} DRIP COIN · +5 per signature play`} onClose={onClose} maxWidth={560}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 480, overflow: 'auto' }}>
        {POWERUPS.map((p) => {
          const have = inventory[p.id] ?? 0;
          const afford = coins >= p.price;
          const timingTag = p.timing === 'pre' ? 'PRE-MATCH' : 'REAL-TIME';
          return (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 11, background: 'var(--bg)', border: `1px solid ${flash === p.id ? 'var(--you)' : 'var(--bd)'}`, borderRadius: 5, padding: '10px 12px', transition: 'border-color .3s' }}>
              <span style={{ fontSize: 20, flex: 'none', width: 26, textAlign: 'center' }}>{p.icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <span className="grotesk" style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{p.name}</span>
                  <span className="mono" style={{ fontSize: 7.5, fontWeight: 700, letterSpacing: '0.1em', color: p.timing === 'pre' ? 'var(--warn)' : 'var(--you)', border: `1px solid ${p.timing === 'pre' ? 'var(--warn)' : 'var(--you)'}`, borderRadius: 3, padding: '1px 4px' }}>{timingTag}</span>
                  {p.kind === 'metric' && <span className="mono" style={{ fontSize: 7.5, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--dim)', border: '1px solid var(--bd)', borderRadius: 3, padding: '1px 4px' }}>METRIC · 1 WK</span>}
                </div>
                <div style={{ fontSize: 10.5, color: 'var(--dim)', marginTop: 3, lineHeight: 1.4 }}>{p.blurb}</div>
                {have > 0 && <div className="mono" style={{ fontSize: 8.5, color: 'var(--you)', marginTop: 3, letterSpacing: '0.08em' }}>OWNED ×{have}</div>}
              </div>
              <button
                onClick={() => buy(p.id)}
                disabled={!afford}
                className="mono"
                style={{ flex: 'none', fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', borderRadius: 4, padding: '8px 11px', border: 'none', cursor: afford ? 'pointer' : 'default', color: afford ? 'var(--bg)' : 'var(--faint)', background: afford ? 'var(--you)' : 'var(--surface)', opacity: afford ? 1 : 0.6 }}
              >
                ◈ {p.price}
              </button>
            </div>
          );
        })}
      </div>
      <div className="mono" style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '0.06em', marginTop: 12, lineHeight: 1.5 }}>
        PRE-MATCH powerups apply during setup and lock once a window starts. REAL-TIME powerups can be applied during live play. METRIC unlocks last the current week only. Apply them from the matchup screen.
      </div>
    </Modal>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ textAlign: 'right' }}>
      <div className="mono" style={{ fontSize: 8.5, letterSpacing: '0.14em', color: 'var(--faint)' }}>{label}</div>
      <div className="grotesk" style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>{value}</div>
    </div>
  );
}

function ToolButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className="mono" style={{ background: 'var(--surface)', border: '1px solid var(--bd)', color: 'var(--text)', fontSize: 10, letterSpacing: '0.08em', padding: '8px 12px', borderRadius: 4 }}>
      {children}
    </button>
  );
}

function TeamMini({ team, accent, right }: { team: FantasyTeam; accent: string; right?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexDirection: right ? 'row-reverse' : 'row', flex: 1, justifyContent: right ? 'flex-end' : 'flex-start' }}>
      <Avatar name={team.name} accent={accent} size={28} src={avatarUrl(team.ownerId)} />
      <div style={{ textAlign: right ? 'right' : 'left' }}>
        <div className="grotesk" style={{ fontSize: 13, fontWeight: 700, color: accent }}>{team.name}</div>
        <div className="mono" style={{ fontSize: 9, color: 'var(--faint)' }}>SEED {team.seed} · {team.wins}-{team.losses}</div>
      </div>
    </div>
  );
}

// ── Modals ──────────────────────────────────────────────────────────────

function Modal({ title, sub, onClose, children, maxWidth = 480 }: { title: string; sub?: string; onClose: () => void; children: ReactNode; maxWidth?: number }) {
  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.62)', zIndex: 60, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 16px', overflow: 'auto' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth, background: 'var(--surface)', border: '1px solid var(--bdh)', borderRadius: 8, boxShadow: '0 24px 70px rgba(0,0,0,0.5)' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '16px 18px', borderBottom: '1px solid var(--bd)' }}>
          <div>
            <div className="grotesk" style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>{title}</div>
            {sub && <div className="mono" style={{ fontSize: 9.5, letterSpacing: '0.08em', color: 'var(--dim)', marginTop: 3 }}>{sub}</div>}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--dim)', fontSize: 18 }}>✕</button>
        </div>
        <div style={{ padding: 14 }}>{children}</div>
      </div>
    </div>
  );
}

function TeamModal({ teamId, onClose, onOpenTeam }: { teamId: string; onClose: () => void; onOpenTeam: (id: string) => void }) {
  const { demoWeek } = useStore();
  const [tab, setTab] = useState<'roster' | 'schedule'>('roster');
  const team = getTeam(teamId)!;
  const roster = teamRoster(teamId);
  const results = teamResults(teamId);
  return (
    <Modal title={team.name} sub={`${team.owner} · SEED ${team.seed} · ${team.wins}-${team.losses}`} onClose={onClose}>
      <div style={{ display: 'flex', gap: 4, padding: 3, background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 5, marginBottom: 12 }}>
        {(['roster', 'schedule'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className="mono" style={{ flex: 1, padding: '7px', borderRadius: 4, fontSize: 10, letterSpacing: '0.1em', fontWeight: 700, border: 'none', background: tab === t ? 'var(--sh)' : 'transparent', color: tab === t ? 'var(--text)' : 'var(--dim)' }}>
            {t.toUpperCase()}
          </button>
        ))}
      </div>
      {tab === 'roster' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 440, overflow: 'auto' }}>
          {roster.map((p) => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 9, background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 3, padding: '7px 10px' }}>
              <PlayerImg playerId={p.id} team={p.team} pos={p.pos} size={22} />
              <span className="grotesk" style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)', flex: 1 }}>{p.full}</span>
              <span className="mono" style={{ fontSize: 9, color: 'var(--faint)' }}>{p.team}</span>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 440, overflow: 'auto' }}>
          {results.map((r) => {
            const o = getTeam(r.oppId)!;
            const upcoming = r.week > demoWeek;
            const c = upcoming ? 'var(--faint)' : r.result === 'W' ? 'var(--you)' : r.result === 'L' ? 'var(--opp)' : 'var(--dim)';
            return (
              <div key={r.week} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--bg)', border: '1px solid var(--bd)', borderLeft: `3px solid ${c}`, borderRadius: 3, padding: '7px 10px' }}>
                <span className="mono" style={{ fontSize: 9, color: 'var(--faint)', width: 34 }}>WK{r.week}</span>
                <span className="mono" style={{ fontSize: 10, fontWeight: 700, color: c, width: 30 }}>{upcoming ? '—' : r.result}</span>
                <span className="mono" style={{ fontSize: 9, color: 'var(--faint)' }}>vs</span>
                <button onClick={() => onOpenTeam(o.id)} className="grotesk" style={{ fontSize: 12, fontWeight: 700, color: 'var(--dimstrong)', background: 'none', border: 'none', flex: 1, textAlign: 'left' }}>{o.name}</button>
                <span className="mono" style={{ fontSize: 10, color: upcoming ? 'var(--faint)' : 'var(--mid)' }}>{upcoming ? '—' : `${r.ptsFor.toFixed(0)}–${r.ptsAgainst.toFixed(0)}`}</span>
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}

function ScheduleModal({ onClose, onOpenTeam }: { onClose: () => void; onOpenTeam: (id: string) => void }) {
  const { youTeamId: YOU, demoWeek, activeLeague: LEAGUE_REF } = useStore();
  const [week, setWeek] = useState(demoWeek);
  const games = LEAGUE_REF.schedule.filter((g) => g.week === week);
  return (
    <Modal title="All Matchups" sub={`${LEAGUE_REF.name} · ${LEAGUE_REF.season}`} onClose={onClose} maxWidth={620}>
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 12 }}>
        {Array.from({ length: 14 }, (_, i) => i + 1).map((w) => {
          const sel = w === week;
          const cur = w === demoWeek;
          return (
            <button key={w} onClick={() => setWeek(w)} className="mono" style={{ fontSize: 9.5, fontWeight: 700, padding: '5px 9px', borderRadius: 3, border: `1px solid ${sel ? 'var(--you)' : cur ? 'var(--warn)' : 'var(--bd)'}`, background: sel ? 'var(--sh)' : 'transparent', color: sel ? 'var(--you)' : cur ? 'var(--warn)' : 'var(--dim)' }}>
              WK{w}
            </button>
          );
        })}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {games.map((g, i) => {
          const a = getTeam(g.homeId)!;
          const b = getTeam(g.awayId)!;
          const done = week < demoWeek;
          const involvesYou = g.homeId === YOU || g.awayId === YOU;
          const aWon = g.homeScore > g.awayScore;
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg)', border: '1px solid var(--bd)', borderLeft: `3px solid ${involvesYou ? 'var(--you)' : 'var(--bd)'}`, borderRadius: 4, padding: '9px 12px' }}>
              <button onClick={() => onOpenTeam(a.id)} style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'none', border: 'none', flex: 1, minWidth: 0 }}>
                <Avatar name={a.name} accent={done && aWon ? 'var(--you)' : 'var(--dim)'} size={20} src={avatarUrl(a.ownerId)} />
                <span className="grotesk" style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</span>
              </button>
              <span className="mono" style={{ fontSize: 12, fontWeight: 700, color: done && aWon ? 'var(--you)' : 'var(--mid)' }}>{done ? g.homeScore.toFixed(0) : ''}</span>
              <span className="mono" style={{ fontSize: 8.5, color: 'var(--faint)', width: 54, textAlign: 'center', letterSpacing: '0.08em' }}>{done ? 'FINAL' : week === demoWeek ? '● OPEN' : 'UPCOMING'}<br />vs</span>
              <span className="mono" style={{ fontSize: 12, fontWeight: 700, color: done && !aWon ? 'var(--you)' : 'var(--mid)' }}>{done ? g.awayScore.toFixed(0) : ''}</span>
              <button onClick={() => onOpenTeam(b.id)} style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'none', border: 'none', flex: 1, minWidth: 0, justifyContent: 'flex-end' }}>
                <span className="grotesk" style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</span>
                <Avatar name={b.name} accent={done && !aWon ? 'var(--you)' : 'var(--dim)'} size={20} src={avatarUrl(b.ownerId)} />
              </button>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
