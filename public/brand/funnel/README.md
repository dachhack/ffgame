# The funnel's screens

Phone screenshots for the landing's feature cards (v0.650.0).

**What's here now (v0.650.1) are stand-ins**: the same screens shot from the
web app at phone size against fixture data, until the founder's app
screenshots replace them. Overwrite file for file; the names are fixed. Each card
rotates through its files; a file that isn't here yet shows as a labelled
"SCREEN COMING" placeholder, so drop them in as you shoot them. The names are
fixed — `src/screens/Landing.tsx` (`FUNNEL_SHOTS`) reads them.

Shoot in **portrait** on a phone, in the app, and save as PNG. The frame is
9:19 and crops from the **top**, so the thing you're showing should sit in
the upper two-thirds of the screen. The status bar is fine to leave in; the
frame hides nothing that matters.

| File | Card | Show |
|---|---|---|
| `league-redraft.png` | League types | A redraft league's settings or draft board |
| `league-contract.png` | League types | A contract league: salaries and terms under the cap |
| `league-full-college.png` | League types | An all-college league (a college roster or player pool) |
| `league-mixed-college.png` | League types | A mixed NFL + college roster |
| `league-devy-market.png` | League types | The devy market: shares and prices |
| `mode-vampire.png` | Competitive modes | A vampire league: the fang on a team, or a bite |
| `mode-guillotine.png` | Competitive modes | The guillotine panel: who's on the block |
| `mode-golf.png` | Competitive modes | A golf league's standings (lowest wins) |
| `mode-bullseye.png` | Competitive modes | A bullseye matchup: the targets and your distance from them |
| `positions-scoped.png` | Positions | The roster builder with a scoped, named spot ("one rookie WR", "a Cowboy") |
| `positions-hc-draft.png` | Positions | A draft with head coaches on the board |
| `scoring-bestball-mix.png` | Scoring options | A lineup mixing best-ball spots and hand-set (non-roster) spots |
| `scoring-scoped-bonuses.png` | Scoring options | The scoped-bonuses screen |

The matchup card rotates the site's existing drip and classic screens in
`public/brand/` (`shot-drip-live.png`, `shot-sealed.jpg`, `shot-duel.png`,
`shot-classic.png`), landscape, under the "Click here for a demo" button.
