import { useState, type ReactNode } from 'react';

// Plain-language FAQ. The Rulebook (src/screens/Rulebook.tsx) is the deep scoring
// reference rendered from live data; this page answers the "what is this / is it
// safe / can I play" questions a first-time visitor actually asks. Keep answers
// short and point at the Rulebook for mechanics rather than duplicating them.

const card: React.CSSProperties = { background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 10, padding: '4px 16px', marginBottom: 14 };
const kicker: React.CSSProperties = { fontFamily: 'monospace', fontSize: 8.5, fontWeight: 700, letterSpacing: '0.16em', color: 'var(--you)', padding: '14px 0 2px' };

interface QA { q: string; a: ReactNode; }
interface Section { id: string; title: string; items: QA[]; }

function Item({ q, a }: QA) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ borderTop: '1px solid var(--bd)' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={{
          width: '100%', display: 'flex', alignItems: 'flex-start', gap: 10, textAlign: 'left',
          background: 'none', border: 'none', cursor: 'pointer', padding: '13px 0', color: 'var(--text)',
        }}
      >
        <span className="mono" style={{ fontSize: 13, color: 'var(--you)', flex: 'none', lineHeight: 1.45, width: 12 }}>{open ? '–' : '+'}</span>
        <span className="grotesk" style={{ fontSize: 13.5, fontWeight: 700, lineHeight: 1.45 }}>{q}</span>
      </button>
      {open && (
        <div style={{ fontSize: 13, lineHeight: 1.62, color: 'var(--dim)', padding: '0 0 14px 22px' }}>{a}</div>
      )}
    </div>
  );
}

export function Faq({ onClose, onOpenRulebook }: { onClose: () => void; onOpenRulebook?: () => void }) {
  const rulebookLink = (label: string) =>
    onOpenRulebook
      ? <button onClick={() => { onClose(); onOpenRulebook(); }} className="mono" style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', fontWeight: 700, color: 'var(--you)', cursor: 'pointer' }}>{label}</button>
      : <b style={{ color: 'var(--you)' }}>{label}</b>;

  const SECTIONS: Section[] = [
    {
      id: '01', title: 'GETTING STARTED',
      items: [
        {
          q: 'What is Drip Fantasy?',
          a: <>A real-time, head-to-head fantasy football game where <b>how</b> you score matters as much as <b>who</b> you start.
            Instead of piling up raw points, you assign each roster player to a game-time <b>window slot</b> and pair them with a
            hidden <b>scoring metric</b> that carries a strategic effect — a nuke, an erase, a hot streak, a multiplier. Picks stay
            sealed until kickoff, then resolve live as the real NFL games play out.</>,
        },
        {
          q: 'Is this a real game or just a demo?',
          a: <>What you're looking at now is the <b>Drip Test League</b> — a fully playable demo that runs entirely in your browser on
            real 2025 NFL data. There's no live opponent and no money involved; it's there to show how a week plays out. The live,
            play-with-your-league version is in a limited pilot (see “Can I play with my own league?” below).</>,
        },
        {
          q: 'Do I need an account to try it?',
          a: <>No. You can <b>Explore the demo league</b> straight from the splash screen with no sign-up. If you want to see the demo
            re-skinned over your own league, type your <b>Sleeper username</b> on the splash — that's it. An account (magic-link email)
            is only needed for the invited live pilot.</>,
        },
        {
          q: 'How do I actually play a week?',
          a: <>Open a matchup and you'll move through three phases: <b>SETUP</b> (build a lineup across the 5 windows and seal a hidden
            metric on each slot), <b>LIVE</b> (picks reveal at kickoff and effects fire on the real game clock), and <b>FINAL</b>
            (the week's result across all slots). The {rulebookLink('Rulebook')} walks through the full flow.</>,
        },
      ],
    },
    {
      id: '02', title: 'YOUR DATA & PRIVACY',
      items: [
        {
          q: 'Do you need my Sleeper password?',
          a: <>Never. We only ask for your <b>Sleeper username</b>, which we use to read your public league info through Sleeper's
            public API. We never ask for, see, or store a password.</>,
        },
        {
          q: 'Is the NFL data real?',
          a: <>Yes. The stats, schedule and scores come from genuine 2025 NFL data (nflverse / Sleeper sources via Stathead) — real
            season box scores for around 250 skill players seed every simulated game. The data is real; the <i>league</i> wrapped
            around the demo is sanitized.</>,
        },
        {
          q: 'Whose league is the demo based on?',
          a: <>Nobody's, really. The “Drip Test League” is a fabricated 10-team dynasty re-skin over a real 2025 season. The team names,
            manager handles, avatars and league name are all made up, so the demo never exposes a real person's private league.</>,
        },
        {
          q: 'Why does a matchup play out the same way every time?',
          a: <>The demo's live scoring is a <b>deterministic simulation</b>: each player's real season averages set a weekly baseline,
            seeded variance adds boom/bust texture, and the metric effects resolve over a generated play-by-play timeline. Because it's
            seeded, a given matchup always plays out identically — which is what lets the whole thing run as a backend-free static site.</>,
        },
      ],
    },
    {
      id: '03', title: 'HOW THE GAME WORKS',
      items: [
        {
          q: 'How is this different from regular fantasy football?',
          a: <>Two big twists. First, your picks are <b>hidden</b> until kickoff — you and your opponent both seal a player <i>and</i> a
            secret metric per slot. Second, metrics don't just score points, they <b>attack</b> the slot across from them: a nuke zeros
            a banked score, an erase cancels recent accumulation, a hot streak doubles your drip rate. You can win by scoring big
            <b> or</b> by shutting your opponent down.</>,
        },
        {
          q: 'What is a “metric” and why is it hidden?',
          a: <>A metric is the secret rule you attach to each player that decides <b>how</b> their real NFL game becomes points — and what
            effect it fires at your opponent. Hiding it until kickoff is the core of the game: your opponent sets their lineup without
            knowing whether you're racing for points or loading up denial. See the full {rulebookLink('metric catalog')}.</>,
        },
        {
          q: 'How does scoring and “drip” work?',
          a: <>Drip metrics don't score yards directly — each productive touch raises a <b>rate</b> (points per minute) that accrues while
            your team has the ball, on the real game clock. Catches can erase it, a target pauses it, and a touchdown wipes the bank.
            Three straight productive touches with no opponent score go <b>hot</b> and double the rate. The {rulebookLink('Rulebook')} has
            the exact numbers.</>,
        },
        {
          q: 'What are power-ups and drip-coin?',
          a: <>You earn <b>drip-coin</b> each week and spend it on <b>power-ups</b> — consumables like an Extra Slot, a live Metric Swap, a
            Spy peek, or Double-or-Nothing. Some arm before kickoff, others fire mid-game. The {rulebookLink('Rulebook')} lists the full
            shop. (In the demo you start with a coin grant so you can try them freely.)</>,
        },
      ],
    },
    {
      id: '04', title: 'LEAGUES, APPS & ACCESS',
      items: [
        {
          q: 'Can I play with my own league and friends?',
          a: <>That's the goal. Live head-to-head play against your real leaguemates is currently in a limited <b>pilot</b>. If you're
            interested, use the <b>request an invite</b> link on the splash screen (or the floating request button) and we'll be in touch.</>,
        },
        {
          q: 'Is there a mobile app?',
          a: <>Not yet — Drip Fantasy is a web app today and works in your phone's browser. Native iOS and Android apps are on the roadmap;
            the game engine is built to be portable so the same play loop can ship to phones later.</>,
        },
        {
          q: 'Does it cost anything?',
          a: <>The demo is completely free and always will be. The drip-coin and power-ups in the demo are in-game currency, not real
            money. Pricing for the live, full-league product is still being worked out as part of the pilot.</>,
        },
        {
          q: 'I have an invite code — where do I enter it?',
          a: <>On the splash screen choose <b>Already invited? Sign in</b> to start the live pilot. If your commissioner sent you a share
            link with a code, opening that link pre-fills it for you after you sign in with your email.</>,
        },
      ],
    },
  ];

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'var(--bg)', overflowY: 'auto' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 1, background: 'var(--bg)', borderBottom: '1px solid var(--bd)', padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="grotesk" style={{ fontSize: 15, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--text)' }}>◆ DRIP FANTASY — FAQ</span>
        <button onClick={onClose} className="mono" style={{ fontSize: 11, fontWeight: 700, color: 'var(--dim)', background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 5, padding: '6px 12px', cursor: 'pointer' }}>✕ close</button>
      </div>

      <div style={{ maxWidth: 640, margin: '0 auto', padding: '18px 16px 60px' }}>
        <p style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text)', margin: '0 0 16px' }}>
          New here? Start with these. For the exact scoring rules, metric catalog and power-up shop, see the {rulebookLink('Rulebook →')}.
        </p>

        {SECTIONS.map((s) => (
          <div key={s.id} style={card}>
            <div style={kicker}>{s.id} · {s.title}</div>
            {s.items.map((it) => <Item key={it.q} q={it.q} a={it.a} />)}
          </div>
        ))}

        <p style={{ fontSize: 11, lineHeight: 1.6, color: 'var(--dim)', textAlign: 'center', marginTop: 4 }}>
          Still stuck? Use the <b>request an invite</b> button to get in touch.
        </p>
      </div>
    </div>
  );
}
