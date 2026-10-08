# The funnel's screens

Phone screenshots for the landing's feature cards (v0.650.0).

**What's here now (v0.652.2) are stand-ins**: the in-game screens shot from the
web app at phone size against fixture data, mark-free (no NFL logos or
headshots), until the founder's app screenshots replace them. Overwrite file
for file; the names are fixed. Shoot yours mark-free too (Settings, or
`?markfree=1` on the URL). Each card
rotates through its files; a file that isn't here yet shows as a labelled
"SCREEN COMING" placeholder, so drop them in as you shoot them. The names are
fixed — `src/screens/Landing.tsx` (`FUNNEL_SHOTS`) reads them.

Shoot in **portrait** on a phone, in the app, and save as PNG. The frame is
wide (3:4 on a phone, square on a desktop) and crops from the **top**, so
crop your shot to start right where the content starts (no status bar, no
app header) and keep the thing you're showing in the upper half.

| File | Card | Show |
|---|---|---|
| `league-redraft.png` | League types | The classic matchup board (the Redraft · Keeper · Dynasty chip) |
| `league-contract.png` | League types | The cap sheet: every deal, its salary and years, under the cap |
| `league-full-college.png` | League types | A matchup board where every spot is a 2026 college player, Saturday games |
| `league-mixed-college.png` | League types | An NFL matchup board (no K or D/ST) opening on two NFL spots and the two college spots |
| `league-devy-market.png` | League types | The devy market: prices, stakes, and BUY |
| `mode-vampire.png` | Competitive modes | The vampire's feeding log: each win and the bite it earned |
| `mode-guillotine.png` | Competitive modes | The chop report: one finished week on the block, who fell |
| `mode-golf.png` | Competitive modes | A golf matchup board: LOW WINS, real low-usage starters projected a point or two |
| `mode-bullseye.png` | Competitive modes | A bullseye matchup board: the target per spot and the distance from it |
| `positions-roster.png` | Positions | The roster builder with a spread of spot kinds: superflex, rookie-only, one-team, best ball, zero-fill, IDP, returner, head coach |
| `positions-scoped.png` | Positions | A lineup with Vets 7+, NFC Only and Rookie SF spots, on 2026 rosters |
| `scoring-bestball-mix.png` | Scoring options | A matchup board with one best-ball spot (FLEX, AUTO) among hand-set ones |
| `scoring-scoped-bonuses.png` | Scoring options | Scoring → Adjustments, opening on the scoped-bonus rules and the scope chips |

The matchup card rotates the site's existing drip and classic screens in
`public/brand/` (`shot-drip-live.png`, `shot-sealed.jpg`, `shot-duel.png`,
`shot-classic.png`), landscape, under the "Click here for a demo" button.
