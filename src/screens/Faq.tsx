import { useState, type ReactNode } from 'react';
import { APK_URL, APK_ZIP_URL, IOS_TESTFLIGHT_URL } from '@drip/core/data/changelog';

// Plain-language FAQ. The Rulebook (src/screens/Rulebook.tsx) is the deep scoring
// reference rendered from live data; this page answers the "what is this / is it
// safe / can I play" questions a first-time visitor actually asks. Keep answers
// short and point at the Rulebook for mechanics rather than duplicating them.

const SUPPORT_EMAIL = 'hi@dripfantasy.com';

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
  const mailLink = <a href={`mailto:${SUPPORT_EMAIL}`} style={{ color: 'var(--you)', fontWeight: 700, textDecoration: 'none' }}>{SUPPORT_EMAIL}</a>;

  const ext = (href: string, label: string) => <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--you)', fontWeight: 700, textDecoration: 'none' }}>{label}</a>;

  // THE v0.656.5 REVISION (founder: "a complete revision removing AI tells and
  // focusing more on the complete product as a classic fantasy platform with
  // drip as one feature"): the league comes first and Drip is one game in it.
  // The founder's bio is the founder's approved text (v0.656.5); keep it to
  // what a public resume says.
  const SECTIONS: Section[] = [
    {
      id: '01', title: 'THE BASICS',
      items: [
        {
          q: 'What is Drip Fantasy?',
          a: <>A free fantasy football platform. You can run a normal head-to-head league here: draft, set lineups, make trades
            and waiver claims, and watch scores update live on real NFL play-by-play. You can also run the leagues other sites
            don't support, like guillotine, vampire, golf, devy or a league with its own scoring rules. <b>Drip</b> is one game
            you can pick for a league. It adds sealed picks and live effects on top of fantasy football. Most leagues here play classic.</>,
        },
        {
          q: 'What kinds of leagues can I run?',
          a: <>The commissioner sets each part separately.
            <br /><b>Season:</b> redraft, keeper, dynasty with rookie drafts and tradeable future picks, or contract leagues with salaries under a cap.
            <br /><b>Draft:</b> snake, linear or auction, live or slow.
            <br /><b>Format:</b> head-to-head, guillotine, vampire, golf, Bullseye or Shotgun Wedding.
            <br /><b>Roster:</b> any mix of positions, including superflex, IDP, kickers, defenses and college players, plus spots limited to a team or to rookies.
            <br /><b>Scoring:</b> standard through full PPR, around forty per-stat settings, best ball (one spot or all of them) and bonuses for players matching a filter.
            <br />If your league has a rule we can't set up yet, email {mailLink} and we'll try to add it.</>,
        },
        {
          q: 'Can I bring my existing league?',
          a: <>Yes. Leagues on <b>Sleeper</b>, <b>ESPN</b>, <b>Yahoo</b>, <b>MyFantasyLeague</b> and <b>Fleaflicker</b> can be
            connected. You can also start a new league here and draft in the app, with no other site involved. If your league
            is somewhere else, use <b>Ask us to set up a league</b> at the bottom of the front page.</>,
        },
        {
          q: 'Is it free?',
          a: <>Yes, and the plan is to keep it that way. Drip-coin and power-ups are game currency, not real money. Live NFL data
            does cost money, so if the site grows a lot we may need a paid option to cover it. The core game will stay free.</>,
        },
        {
          q: 'Who builds this?',
          a: <><b>Matt Porritt, PhD.</b> Matt has spent 20 years building and leading data science and analytics teams, most
            recently as Senior Director of Data Analytics at Cox Enterprises. Before that Matt set up data and analytics at a
            live-event ticketing start-up and built churn and next-best-action models for Cox Communications' customer base.
            Matt holds a PhD in applied behavior analysis from Western Michigan University, with a concentration in
            experimental design.
            <br /><br />In 2026 Matt built {ext('https://stathead.app', 'stathead.app')}, an open NFL analytics platform that
            supplies Drip Fantasy's stats, and then built Drip Fantasy itself, with AI as a coding partner. Most new features
            start as a request from someone playing. Matt's analytics consulting is at{' '}
            {ext('https://oberonanalytics.ai', 'oberonanalytics.ai')}, and you can connect on{' '}
            {ext('https://www.linkedin.com/in/makeitraininsights/', 'LinkedIn')}. Ideas and bug reports go straight to Matt at {mailLink}.</>,
        },
      ],
    },
    {
      id: '02', title: 'PLAYING',
      items: [
        {
          q: 'How does a classic league work here?',
          a: <>The way you'd expect. Set a lineup, and each spot locks when its player's game kicks off, so you can still swap
            your Sunday players after Thursday night. Points come in live while games are on. Waivers, free agents, trades,
            injured reserve and league chat all work as they do elsewhere. The commissioner controls the settings.</>,
        },
        {
          q: 'How live is the scoring?',
          a: <>While NFL games are on, we read the real play-by-play continuously and update every matchup within moments of each
            play. Injury designations refresh hourly in the run-up to each slate.</>,
        },
        {
          q: 'What is Drip?',
          a: <>A different game you can choose for a league. Each starter goes into a kickoff window with a <b>hidden scoring
            metric</b> that neither side sees until kickoff. Metrics score points and can also hit the opponent's player in the
            same spot: a nuke wipes their banked points, an erase cancels recent scoring, a hot streak doubles your rate. You can
            win by outscoring the other team or by shutting them down. The {rulebookLink('Rulebook')} has every metric.</>,
        },
        {
          q: 'How does Drip scoring work?',
          a: <>Drip metrics don't count yards directly. Each productive touch raises a <b>rate</b> (points per minute) that builds
            while your team has the ball, on the real game clock. Three productive touches in a row with no opponent score go
            <b> hot</b> and double the rate. The {rulebookLink('Rulebook')} has the exact numbers.</>,
        },
        {
          q: 'What are power-ups and drip-coin?',
          a: <>In Drip leagues you earn <b>drip-coin</b> each week and spend it on <b>power-ups</b>, like an extra slot, a mid-game
            metric swap or a peek at the other lineup. Some arm before kickoff and some fire during the game. The
            full list is in the {rulebookLink('Rulebook')}.</>,
        },
        {
          q: 'Can I try it before signing up?',
          a: <>Yes. The <b>demo</b> link at the top of the front page plays a full week of Drip in your browser on real 2025 NFL
            plays, with no account. The teams and managers in it are made up.</>,
        },
      ],
    },
    {
      id: '03', title: 'ACCOUNT & DATA',
      items: [
        {
          q: 'Do you need my Sleeper password?',
          a: <>No. For Sleeper we only need your username, which reads your league's public info. We never ask for or store a
            Sleeper password.</>,
        },
        {
          q: 'Is my data shared or sold?',
          a: <>No. We keep your email and handle to run your account, and anonymous usage stats to see which screens get used. We
            don't sell data or share it with advertisers. To have yours removed, email {mailLink}.</>,
        },
        {
          q: 'What happens if I stop playing?',
          a: <>If an account goes unused for 30 days we email you. If we don't hear back, it's removed 14 days after that. Your
            personal details are deleted. Leagues you played in keep their results, with your team shown by name.</>,
        },
        {
          q: 'Is the NFL data real?',
          a: <>Yes. Live leagues use real 2026 play-by-play as it happens. The demo replays real 2025 games.</>,
        },
      ],
    },
    {
      id: '04', title: 'APPS & HELP',
      items: [
        {
          q: 'Is there a phone app?',
          a: <><b>iPhone:</b> the app is in beta on TestFlight. {ext(IOS_TESTFLIGHT_URL, 'Join the beta')}, install
            Apple's TestFlight app if asked, then install Drip Fantasy from there.
            <br /><b>Android:</b> {ext(APK_ZIP_URL, 'download the app')}, unzip it, and tap the file inside. Android will ask once
            to allow installs from your browser. If you'd rather skip the unzip, here's the {ext(APK_URL, 'direct .apk')}.
            <br />Everything also works in a phone browser. What changed in each version is under <b>⚙ → What's new</b>.</>,
        },
        {
          q: 'I have an invite code. Where does it go?',
          a: <>Open the invite link your commissioner sent and the code fills itself in after you sign in. If you only have the
            code, sign in and add a league from <b>My Leagues</b>.</>,
        },
        {
          q: 'I found a bug or have an idea. How do I reach you?',
          a: <>Email {mailLink}. Every message gets read.</>,
        },
      ],
    },
  ];

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'var(--bg)', overflowY: 'auto' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 1, background: 'var(--bg)', borderBottom: '1px solid var(--bd)', padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="grotesk" style={{ fontSize: 15, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--text)' }}>◆ DRIP FANTASY · FAQ</span>
        <button onClick={onClose} className="mono" style={{ fontSize: 11, fontWeight: 700, color: 'var(--dim)', background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 5, padding: '6px 12px', cursor: 'pointer' }}>✕ close</button>
      </div>

      <div style={{ maxWidth: 640, margin: '0 auto', padding: '18px 16px 60px' }}>
        <p style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text)', margin: '0 0 16px' }}>
          New here? Start with these. For exact scoring rules, see the {rulebookLink('Rulebook →')}.
        </p>

        {SECTIONS.map((s) => (
          <div key={s.id} style={card}>
            <div style={kicker}>{s.id} · {s.title}</div>
            {s.items.map((it) => <Item key={it.q} q={it.q} a={it.a} />)}
          </div>
        ))}

        <p style={{ fontSize: 11, lineHeight: 1.6, color: 'var(--dim)', textAlign: 'center', marginTop: 4 }}>
          Still have a question? Email {mailLink}.
        </p>
      </div>
    </div>
  );
}
