// MY TEAM for an EXTERNAL league, on the web (v0.356.17, founder: "We need a
// my team section on web. This should apply to native, and non-native teams
// (sleeper)").
//
// The web has had MY TEAM for native leagues since forever — TeamManage, the
// full desk with waivers, trades and contracts. An imported league had NO team
// page at all here: the room was gated `native && rosterId != null`, with a
// note that the app's read-only page (v0.356.5) had no web sibling yet. This
// is that sibling, and the gate comes off with it.
//
// A platform league's roster is MANAGED on its platform — Sleeper, ESPN,
// Fleaflicker — but the weekly sync already carries it here (sleeper_lineup,
// read through core's shared pool reader), so the web can at least SHOW it:
// your identity, and who you are holding, grouped the way the native desk
// groups them. Deliberately READ-ONLY: no waivers, no trades, no rename. Those
// live on the platform, and a control here that would drift from it is worse
// than no control at all.
//
// Mirrors apps/mobile/src/screens/PlatformTeam.tsx — same groups, same order,
// same sentence about where the league really lives.
import { useEffect, useState } from 'react';
import { myEnrollments, myLatestPool, type PoolPlayer } from '@drip/core/data/liveApi';
import { openPlayerCard } from '../app/playerCard';
import { Img } from '../app/ui';

const card: React.CSSProperties = { background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 8, padding: 18 };
const hdr: React.CSSProperties = { fontSize: 10, letterSpacing: '0.12em', color: 'var(--dim)', fontWeight: 700, marginBottom: 8 };

const POS_ORDER: Record<string, number> = { QB: 0, RB: 1, WR: 2, TE: 3, K: 4, DEF: 5 };
const GROUPS: { id: PoolPlayer['grp']; label: string }[] = [
  { id: 'start', label: 'STARTERS' },
  { id: 'bench', label: 'BENCH' },
  { id: 'ir', label: 'INJURED RESERVE' },
  { id: 'taxi', label: 'TAXI SQUAD' },
];
const PROVIDER_NAME: Record<string, string> = { sleeper: 'Sleeper', espn: 'ESPN', fleaflicker: 'Fleaflicker' };

export function PlatformTeam({ leagueId, rosterId, userId }: {
  leagueId: string; rosterId: number;
  /** Lights the ★ on any player card opened from here. */
  userId?: string;
}) {
  const [pool, setPool] = useState<{ week: number; players: PoolPlayer[] } | null | 'loading'>('loading');
  const [me, setMe] = useState<{ team: string; avatar: string | null; provider: string } | null>(null);
  useEffect(() => {
    let dead = false;
    setPool('loading');
    myLatestPool(leagueId, rosterId).then((p) => { if (!dead) setPool(p); }).catch(() => { if (!dead) setPool(null); });
    // my_teams ignores its argument (it keys on auth.uid()) — the seat is
    // looked up by league + roster, which is the pair that identifies it.
    myEnrollments('').then((rows) => {
      const e = rows.find((r) => r.league_id === leagueId && r.sleeper_roster_id === rosterId);
      if (!dead && e) setMe({ team: e.team_name, avatar: e.avatar_url, provider: e.league?.provider ?? 'sleeper' });
    }).catch(() => {});
    return () => { dead = true; };
  }, [leagueId, rosterId]);

  const provider = PROVIDER_NAME[me?.provider ?? ''] ?? 'your platform';
  const players = pool !== 'loading' && pool ? pool.players : [];
  const byGroup = GROUPS.map((g) => ({
    ...g,
    players: players.filter((p) => p.grp === g.id)
      .sort((a, b) => (POS_ORDER[a.pos] ?? 9) - (POS_ORDER[b.pos] ?? 9) || a.full.localeCompare(b.full)),
  })).filter((g) => g.players.length > 0);

  return (
    <div>
      {me && (
        <div style={{ ...card, padding: 12, marginBottom: 12, borderLeft: '3px solid var(--you)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Img src={me.avatar} size={42} radius={9} alt=""
              fallback={<span style={{ fontSize: 15, fontWeight: 700, color: 'var(--you)' }}>{(me.team || '?').slice(0, 1).toUpperCase()}</span>} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="grotesk" style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{me.team}</div>
              <div className="mono" style={{ fontSize: 9, color: 'var(--faint)', marginTop: 2 }}>
                managed on {provider} — rosters, waivers &amp; trades live there
              </div>
            </div>
          </div>
        </div>
      )}

      <div style={card}>
        {pool === 'loading' && <div className="mono" style={{ fontSize: 11, color: 'var(--dim)' }}>Loading your roster…</div>}
        {pool !== 'loading' && !pool && (
          <div className="mono" style={{ fontSize: 10.5, color: 'var(--faint)', lineHeight: 1.6 }}>
            No synced roster yet — it arrives with the league’s first weekly sync from {provider}.
          </div>
        )}
        {pool !== 'loading' && pool && (
          <>
            <div style={hdr}>MY ROSTER ({players.length}) · SYNCED WK {pool.week}</div>
            {byGroup.map((g) => (
              <div key={g.id}>
                {/* The lone group needs no heading when it is the STARTERS —
                    "MY ROSTER" already said it. Any other single group does. */}
                {(byGroup.length > 1 || g.id !== 'start') && (
                  <div className="mono" style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: 1, marginTop: 14 }}>
                    {g.label} ({g.players.length})
                  </div>
                )}
                {g.players.map((p) => (
                  <button key={`${g.id}-${p.slug}-${p.full}`}
                    onClick={() => openPlayerCard({ slug: p.slug, name: p.full, pos: p.pos, team: p.team, userId, leagueId })}
                    style={{ display: 'flex', alignItems: 'baseline', gap: 9, width: '100%', textAlign: 'left', padding: '6px 0', marginTop: 5, borderTop: '1px solid var(--bd)', borderLeft: 'none', borderRight: 'none', borderBottom: 'none', background: 'none', cursor: 'pointer', font: 'inherit', color: 'inherit' }}>
                    <span className="mono" style={{ fontSize: 9, fontWeight: 700, color: 'var(--dim)', width: 32, flexShrink: 0 }}>{p.pos === 'DEF' ? 'DST' : p.pos}</span>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.full}</span>
                    <span className="mono" style={{ fontSize: 9, color: 'var(--faint)', flexShrink: 0 }}>{p.team}</span>
                  </button>
                ))}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
