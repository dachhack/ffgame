# The funnel's screens

Phone screenshots for the landing's feature cards (v0.650.0).

**What's here now (v0.650.3) are stand-ins**: the in-game screens shot from the
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
| `league-redraft.png` | League types | The classic matchup board, a redraft league |
| `league-contract.png` | League types | The cap sheet: every deal, its salary and years, under the cap |
| `league-full-college.png` | League types | A matchup board where every spot is a college player, Saturday games |
| `league-mixed-college.png` | League types | An NFL matchup board with two college spots beside the nine |
| `league-devy-market.png` | League types | The devy market: prices, stakes, and BUY |
| `mode-vampire.png` | Competitive modes | The vampire's feeding log: each win and the bite it earned |
| `mode-guillotine.png` | Competitive modes | The chop report: one finished week on the block, who fell |
| `mode-golf.png` | Competitive modes | A golf matchup board: LOW WINS, every starter projected near zero |
| `mode-bullseye.png` | Competitive modes | A bullseye matchup board: the target per spot and the distance from it |
| `positions-scoped.png` | Positions | A lineup with an NFC Only spot and a rookie-only superflex that fills itself |
| `positions-hc-draft.png` | Positions | The draft room with the pool filtered to head coaches |
| `scoring-bestball-mix.png` | Scoring options | A matchup board mixing best-ball spots (AUTO) with hand-set ones |
| `scoring-scoped-bonuses.png` | Scoring options | Scoring → Adjustments: the scoped bonuses |

The matchup card rotates the site's existing drip and classic screens in
`public/brand/` (`shot-drip-live.png`, `shot-sealed.jpg`, `shot-duel.png`,
`shot-classic.png`), landscape, under the "Click here for a demo" button.
