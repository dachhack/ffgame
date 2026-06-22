import { useStore } from '../app/store';
import { Brand, Header, ThemeSwitcher, UserChip, Avatar, DemoControls, fonts } from '../app/ui';
import { getTeam, gameForTeam } from '../data/league';
import { TOTAL_SLOTS } from '../data/metrics';
import { SLEEPER_HANDLE } from '../config';
import { weekLockLabel } from '../data/nflSlate';

const { MONO, GROTESK } = fonts;

// A few of dachhack's other real Sleeper leagues, shown as a portfolio.
const OTHER_LEAGUES = [
  { name: 'Smash Mouth All Stars', format: 'Dynasty · 2QB · 10', state: 'LOCKED' as const },
  { name: 'Console Warriors BestBall Dynasty', format: 'Dynasty · SF · 12', state: 'LIVE' as const },
  { name: 'Hogwart’s Champions', format: 'Dynasty · SF · 10', state: 'LOCKED' as const },
];

function StatePill({ state }: { state: 'OPEN' | 'LOCKED' | 'LIVE' }) {
  const map = {
    OPEN: { c: 'var(--warn)', label: 'OPEN' },
    LOCKED: { c: 'var(--you)', label: 'LOCKED' },
    LIVE: { c: '#FF4F62', label: '● LIVE' },
  };
  const m = map[state];
  return (
    <span className="mono" style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.14em', color: m.c, border: `1px solid ${m.c}`, padding: '2px 7px', borderRadius: 3 }}>
      {m.label}
    </span>
  );
}

export function LeagueHub() {
  const { navigate, youTeamId, demoWeek, activeLeague: LEAGUE_REF, sleeperUser } = useStore();
  const you = getTeam(youTeamId)!;
  const game = gameForTeam(youTeamId, demoWeek)!;
  const opp = getTeam(game.oppId)!;
  const connected = 1 + OTHER_LEAGUES.length;

  return (
    <>
      <Header
        left={
          <>
            {sleeperUser && (
              <button onClick={() => navigate({ name: 'leagues' })} className="mono" title="Back to your leagues" style={{ fontSize: 9, letterSpacing: '0.1em', color: 'var(--dim)', background: 'var(--surface)', border: '1px solid var(--bd)', padding: '6px 9px', borderRadius: 4, cursor: 'pointer' }}>← LEAGUES</button>
            )}
            <Brand /><ThemeSwitcher />
          </>
        }
        right={
          <>
            <UserChip handle={sleeperUser?.username ?? SLEEPER_HANDLE} sub="VIA SLEEPER" />
          </>
        }
      />
      <main style={{ flex: 1, overflow: 'auto', padding: '26px 18px 60px' }}>
        <div style={{ maxWidth: 1080, margin: '0 auto' }}>
          <div className="grotesk" style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text)' }}>
            Your Leagues
          </div>
          <div className="mono" style={{ fontSize: 11, letterSpacing: '0.08em', color: 'var(--dim)', marginTop: 6 }}>
            {connected} CONNECTED · SLEEPER DYNASTY PORTFOLIO
          </div>

          <div style={{ margin: '22px 0 14px', maxWidth: 460 }}>
            <DemoControls />
          </div>

          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, margin: '0 0 12px' }}>
            <span className="grotesk" style={{ fontSize: 15, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--text)' }}>WEEK {demoWeek}</span>
            <span style={{ fontSize: 11, color: 'var(--dim)' }}>Kickoff Thu 8:15p · set your windows before lock</span>
          </div>

          {/* primary league card */}
          <button
            onClick={() => navigate({ name: 'league' })}
            style={{
              width: '100%', textAlign: 'left', background: 'var(--surface)', border: '1px solid var(--bd)',
              borderLeft: '3px solid var(--warn)', borderRadius: 5, padding: '18px 20px', color: 'var(--text)',
              display: 'block', marginBottom: 12,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span className="grotesk" style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>{LEAGUE_REF.name}</span>
                  <StatePill state="OPEN" />
                </div>
                <div className="mono" style={{ fontSize: 10, letterSpacing: '0.06em', color: 'var(--dim)', marginTop: 5 }}>
                  {LEAGUE_REF.format} · {you.wins}-{you.losses} · {LEAGUE_REF.season}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <div style={{ textAlign: 'right' }}>
                  <div className="mono" style={{ fontSize: 8, letterSpacing: '0.2em', color: 'var(--faint)' }}>LOCKS IN</div>
                  <div className="mono" style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--warn)' }}>{weekLockLabel(demoWeek)}</div>
                </div>
                <span
                  className="mono"
                  style={{
                    fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--on-accent)', background: 'var(--you)',
                    padding: '9px 14px', borderRadius: 4, boxShadow: '0 0 20px color-mix(in srgb, var(--you) 30%, transparent)',
                  }}
                >
                  SET MATCHUP →
                </span>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--bd)', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Avatar name={you.name} accent="var(--you)" size={26} />
                <div>
                  <div className="grotesk" style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--you)' }}>{you.name}</div>
                  <div className="mono" style={{ fontSize: 9, color: 'var(--faint)' }}>SEED {you.seed}</div>
                </div>
              </div>
              <span className="mono" style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '0.14em' }}>VS</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Avatar name={opp.name} accent="var(--opp)" size={26} />
                <div>
                  <div className="grotesk" style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--dimstrong)' }}>{opp.name}</div>
                  <div className="mono" style={{ fontSize: 9, color: 'var(--faint)' }}>SEED {opp.seed}</div>
                </div>
              </div>
              <div style={{ flex: 1 }} />
              <div className="mono" style={{ fontSize: 10, color: 'var(--dim)', letterSpacing: '0.06em' }}>
                0/{TOTAL_SLOTS} SLOTS · H2H 1–1
              </div>
            </div>
          </button>

          {/* secondary leagues */}
          {OTHER_LEAGUES.map((l) => (
            <div
              key={l.name}
              style={{
                background: 'var(--surface)', border: '1px solid var(--bd)',
                borderLeft: `3px solid ${l.state === 'LIVE' ? '#FF4F62' : 'var(--you)'}`,
                borderRadius: 5, padding: '14px 20px', marginBottom: 12, opacity: 0.78,
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap',
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span className="grotesk" style={{ fontSize: 15, fontWeight: 700, color: 'var(--dimstrong)' }}>{l.name}</span>
                  <StatePill state={l.state} />
                </div>
                <div className="mono" style={{ fontSize: 10, letterSpacing: '0.06em', color: 'var(--faint)', marginTop: 4 }}>{l.format}</div>
              </div>
              <span className="mono" style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--dim)', border: '1px solid var(--bd)', padding: '8px 12px', borderRadius: 4 }}>
                {l.state === 'LIVE' ? 'OPEN LIVE' : 'REVIEW LINEUP'}
              </span>
            </div>
          ))}

          <button
            style={{
              width: '100%', background: 'transparent', border: '1px dashed var(--bdh)', borderRadius: 5,
              padding: '16px', color: 'var(--faint)', fontFamily: MONO, fontSize: 11, letterSpacing: '0.12em', marginTop: 4,
            }}
          >
            + CONNECT ANOTHER SLEEPER LEAGUE
          </button>

          <div style={{ marginTop: 28, fontFamily: GROTESK, fontSize: 11, color: 'var(--faint)', textAlign: 'center', lineHeight: 1.7 }}>
            Drip League FF demo · real PeakedInDynasty 2025 data · simulated live scoring
          </div>
        </div>
      </main>
    </>
  );
}
