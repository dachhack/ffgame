// 🎟 THE INVITE LANDING (v0.388.0) — the league, in full, to someone who has
// not signed up yet.
//
// Founder: "I'd love a landing page for the league invite links for external
// viewing. So someone opens the link and gets a preview of the league and
// settings before joining."
//
// The sign-in screen has IDENTIFIED the league since 0206 — crest, name,
// season, and the game's tagline — which answers "which league is this?" and
// nothing else. This card answers the question a recruit actually has before
// making an account: what kind of league is it, how does it score, what does
// the lineup look like, when is the draft, how do waivers work, and is there
// even a seat left. All of it comes from `invite_preview` (0274), which is
// callable signed out because the code is the credential.
//
// It sits ABOVE the password field for the same reason the "you're joining"
// block does: what someone needs to know about what they are signing up FOR
// belongs before they type, not in the fine print after.
import { useEffect, useState } from 'react';
import { invitePreview, type InviteLeaguePreview } from '@drip/core/data/liveApi';

/** Capitalised words from a stored key: 'contract_dynasty' → 'Contract dynasty'. */
const pretty = (s: string) => {
  const t = s.replace(/_/g, ' ').trim();
  return t ? t[0].toUpperCase() + t.slice(1) : t;
};

const FORMAT_LABEL: Record<string, string> = {
  standard: 'Head-to-head', guillotine: '🔪 Guillotine', vampire: '🧛 Vampire',
};
const CONTINUITY_LABEL: Record<string, string> = {
  redraft: 'Redraft', keeper: 'Keeper', dynasty: 'Dynasty',
  contract: 'Contract', contract_dynasty: 'Contract dynasty',
};
const WAIVER_LABEL: Record<string, string> = {
  rolling: 'Rolling priority', priority: 'Rolling priority', faab: 'FAAB blind bids',
};
const REVIEW_LABEL: Record<string, string> = {
  none: 'Trades process immediately', commish: 'Trades need the commissioner',
  league: 'Trades go to a league vote',
};

const label: React.CSSProperties = {
  fontSize: 8.5, fontWeight: 700, letterSpacing: '0.12em',
  textTransform: 'uppercase', color: 'var(--faint)',
};
const val: React.CSSProperties = { fontSize: 12, color: 'var(--text)', lineHeight: 1.5 };

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '96px 1fr', gap: 10, alignItems: 'baseline', padding: '6px 0', borderTop: '1px solid var(--bd)' }}>
      <div className="mono" style={label}>{k}</div>
      <div style={val}>{children}</div>
    </div>
  );
}

/** The classic lineup, said the way a manager reads it: "QB 1 · RB 2 · WR 3". */
function lineupLine(roster: Record<string, number> | null | undefined): string | null {
  if (!roster) return null;
  const ORDER = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'SUPERFLEX', 'SFLEX', 'K', 'DEF', 'DST', 'BENCH', 'IR', 'TAXI'];
  const keys = Object.keys(roster).filter((k) => Number(roster[k]) > 0);
  if (!keys.length) return null;
  keys.sort((a, b) => {
    const ia = ORDER.indexOf(a.toUpperCase()), ib = ORDER.indexOf(b.toUpperCase());
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
  return keys.map((k) => `${k.toUpperCase()} ${roster[k]}`).join(' · ');
}

const pprWords = (ppr: number | null | undefined): string => {
  const n = Number(ppr ?? 1);
  if (!Number.isFinite(n) || n === 0) return 'Standard (no PPR)';
  if (n === 1) return 'Full PPR (1.0 per catch)';
  if (n === 0.5) return 'Half PPR (0.5 per catch)';
  return `${n} per catch`;
};

export function InvitePreviewCard({ code }: { code: string }) {
  const [st, setSt] = useState<InviteLeaguePreview | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let dead = false;
    invitePreview(code)
      .then((r) => { if (!dead) setSt(r); })
      .catch(() => { if (!dead) setSt({ ok: false }); });
    return () => { dead = true; };
  }, [code]);

  // Silent on failure: the sign-in card above already says whether the code
  // matched, and a second, vaguer complaint under it would only muddy that.
  if (!st?.ok) return null;

  const teams = st.teams ?? [];
  const taken = teams.filter((t) => t.taken).length;
  const total = st.seats_total ?? teams.length;
  const lineup = lineupLine(st.roster);
  const d = st.draft ?? null;
  const r = st.rules ?? null;
  const faab = r?.waiver_mode === 'faab' ? r?.faab_budget ?? null : null;

  return (
    <div style={{ maxWidth: 460, margin: '12px auto 0', textAlign: 'left',
      background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 8, padding: '12px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span className="mono" style={{ ...label, color: 'var(--you)' }}>The league at a glance</span>
        <span style={{ flex: 1 }} />
        <span className="mono" style={{ fontSize: 10, fontWeight: 700, color: taken >= total ? 'var(--warn, #c66)' : 'var(--you)', fontVariantNumeric: 'tabular-nums' }}>
          {taken}/{total} seats filled
        </span>
      </div>

      {/* The commissioner's own pitch, when they wrote one. */}
      {!!st.blurb && (
        <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.55, margin: '10px 0 2px' }}>{st.blurb}</div>
      )}

      <div style={{ marginTop: 8 }}>
        <Row k="Format">
          {FORMAT_LABEL[(st.format ?? 'standard')] ?? pretty(st.format ?? 'standard')}
          <span style={{ color: 'var(--dim)' }}>
            {` · ${CONTINUITY_LABEL[(st.continuity ?? 'redraft')] ?? pretty(st.continuity ?? 'redraft')}`}
            {st.game_mode === 'classic' ? ' · Normal scoring' : ' · Drip (live power-ups)'}
          </span>
        </Row>

        <Row k="Scoring">
          {pprWords(st.ppr)}
          {(st.bestball ?? []).length > 0 && (
            <span style={{ color: 'var(--dim)' }}>{` · Best ball in ${(st.bestball ?? []).join(', ')}`}</span>
          )}
        </Row>

        {!!lineup && <Row k="Lineup">{lineup}</Row>}

        {!!d && (
          <Row k="Draft">
            {d.status === 'complete' ? 'Already drafted'
              : d.status === 'live' ? 'Drafting right now'
              : `${pretty(d.mode ?? 'snake')}${d.rounds ? `, ${d.rounds} rounds` : ''}`}
            {d.status !== 'complete' && d.pick_seconds ? (
              <span style={{ color: 'var(--dim)' }}>{` · ${d.pick_seconds}s a pick`}</span>
            ) : null}
            {d.mode === 'auction' && d.budget ? (
              <span style={{ color: 'var(--dim)' }}>{` · $${d.budget} budget`}</span>
            ) : null}
          </Row>
        )}

        {!!r && (
          <Row k="Wire">
            {WAIVER_LABEL[(r.waiver_mode ?? 'rolling')] ?? pretty(r.waiver_mode ?? 'rolling')}
            {faab != null && <span style={{ color: 'var(--dim)' }}>{` · $${faab} budget`}</span>}
            <div style={{ color: 'var(--dim)', fontSize: 11.5 }}>
              {REVIEW_LABEL[(r.trade_review ?? 'none')] ?? pretty(r.trade_review ?? 'none')}
            </div>
          </Row>
        )}

        {!!st.contract_rules?.salary_cap && (
          <Row k="Cap">
            {`$${st.contract_rules.salary_cap} salary cap`}
            {st.contract_rules.years_max ? <span style={{ color: 'var(--dim)' }}>{` · deals up to ${st.contract_rules.years_max} years`}</span> : null}
          </Row>
        )}

        {!!st.dues && <Row k="Dues">{st.dues}</Row>}
      </div>

      {/* WHO IS ALREADY IN. Team names only — the recruit sees these on the
          board the moment they join, and nothing about the people is exposed. */}
      {teams.length > 0 && (
        <div style={{ marginTop: 10, borderTop: '1px solid var(--bd)', paddingTop: 9 }}>
          <button onClick={() => setOpen((v) => !v)} className="mono"
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', ...label, color: 'var(--dim)' }}>
            {open ? '▾' : '▸'} The teams ({teams.length})
          </button>
          {open && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 8 }}>
              {teams.map((t) => (
                <span key={t.roster_id} className="mono"
                  style={{ fontSize: 10.5, padding: '3px 8px', borderRadius: 999,
                    border: `1px solid ${t.taken ? 'var(--bd)' : 'var(--you)'}`,
                    color: t.taken ? 'var(--dim)' : 'var(--you)',
                    background: t.taken ? 'transparent' : 'color-mix(in srgb, var(--you) 10%, var(--surface))' }}>
                  {t.team_name || `Seat ${t.roster_id}`}{t.taken ? '' : ' · open'}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
