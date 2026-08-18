# Gemini prompt — Drip League replacement icon set

Companion to [`audit.md`](./audit.md). Paste the **style block** once, then append
**one subject line** per generation. Gemini does one icon per request reliably;
asking for a sheet of many gives you inconsistent scale and a background you have
to cut out.

There are **100 icons** below: 20 power-ups, 15 live-event effects, 65 UI.
Save each result as `public/icons/<set>/<filename>.png`. Filenames are fixed —
`GameIcon` resolves them by basename and every set shares the same names.

---

## The style block

> You are producing a single icon for a fantasy-football web game called Drip
> League. Output one image only.
>
> **Format.** Square canvas, 512×512, **fully transparent background** (alpha
> PNG). No frame, no card, no backing plate, no ground plane, no drop shadow onto
> anything behind it. The subject floats free. Leave roughly 6% padding on all
> four sides so nothing clips.
>
> **Style.** Soft-3D rendered illustration — the look of a modern glossy emoji or
> a stylised mobile-game asset. Chunky, simplified, confident forms. Smooth
> gradient shading with a single soft key light from the upper left and a gentle
> ambient bounce. A subtle specular highlight on curved surfaces. A thin, dark,
> slightly warm contour holding the silhouette together. Matte-to-satin
> materials — leather, brushed metal, painted plastic — never glass, never chrome
> mirror, never neon glow.
>
> **Silhouette first.** These render inline in running text at **12–28 px**. The
> shape must be identifiable at 16 px as a solid black blob. One clear subject,
> centred, filling the frame. No more than two distinct objects. No thin lines
> under ~8 px of the canvas width, no fine detail, no small text, no numbers, no
> lettering of any kind, no watermark or signature.
>
> **Colour.** Warm, slightly desaturated palette — worn leather browns, aged
> pigskin tan, chalk white, oxidised metal. Accent colours, used sparingly and
> only where the subject calls for it: signal green `#36E59B`, alert red
> `#FF5266`, amber `#FFB23B`.
>
> **Contrast requirement.** The icon ships on seven themes and must read on all
> of them: dark grounds `#24221A`, `#252116`, `#211D15`, `#142A2E`, `#1A1E26`,
> and light grounds `#EFEADD`, `#E9EEF3`. So the subject needs **both** a light
> passage and a dark passage inside its own silhouette — never a uniformly dark
> object and never a uniformly pale one. Give pale subjects a darker contour and
> shadow side; give dark subjects a bright rim light or a light-toned detail.
>
> **Tone.** Sports-memorabilia, slightly retro sticker-pack energy. Physical
> objects and equipment over abstract symbols wherever a physical object will
> carry the meaning. No human faces. No team logos or real NFL marks.
>
> **SUBJECT:**

---

## Tier 1 — Power-ups without art (20)

Data-only to adopt: drop the PNG in, add the id to `PU_ART` in
`src/app/gameIcons.tsx`. These match the 20 existing `pu-*.png` assets in tone.

| filename | `PU_ART` key | SUBJECT line |
|---|---|---|
| `pu-underdog` | `unlock-underdog` | a scrappy underdog's mouthguard and a frayed chinstrap, cheap and worn, tilted like it's just been spat out |
| `pu-second-amp` | `amp-2` | a stadium horn speaker with two stacked sound rings pulsing out of its mouth |
| `pu-third-amp` | `amp-3` | a bigger stadium horn speaker with three stacked sound rings, one amber |
| `pu-floodgates` | `floodgates` | a heavy steel sluice gate cranked wide open with a wall of water surging through |
| `pu-twin-generals` | `fg-stack` | two crossed officer's batons over a small pair of gold shoulder stars |
| `pu-counter-nuke` | `counter-nuke` | a football ricocheting off an angled steel deflector plate, trailing a bent arrow back the way it came |
| `pu-rivalry` | `rivalry` | two identical helmets locked face-mask to face-mask, one green one red |
| `pu-lead-change` | `lead-change` | two runners' legs mid-stride swapping positions on a track, the lead one breaking clear |
| `pu-grudge` | `grudge` | a worn leather boxing glove resting on a football |
| `pu-jinx` | `jinx` | a small hanging charm — a football-shaped talisman on a cord, cracked down the middle |
| `pu-red-herring` | `red-herring` | a fishing lure shaped like a tiny football, hook and all, dangling from a line |
| `pu-bye-steal` | `bye-steal` | a football descending under a small open parachute |
| `pu-ghost` | `ghost` | an empty translucent jersey holding a player's shape with nobody inside it |
| `pu-surge` | `surge` | a football with a hard upward power spike bursting from its base, amber |
| `pu-cold-snap` | `cold-snap` | a football half-encased in a block of pale blue ice, frost creeping across the laces |
| `pu-napalm` | `napalm` | a football fully engulfed in rolling orange flame, its surface charring |
| `pu-bunker` | `bunker` | a squat reinforced concrete bunker dome with a narrow slit, a football safe inside |
| `pu-halftime-gamble` | `clutch-don` | a slot-machine lever pulled down beside two football-pip dice |
| `pu-encore` | `clutch-encore` | a film clapperboard with a football where the hinge marker sits |
| `pu-counter-wipe` | `clutch-counter` | a wooden boomerang curving back around a small scorched football |

## Tier 2 — Live events & recap moments (15)

Data-only: add to `FX_ART` (narration beats) or wire `moments.ts` kinds through
`FxIcon`. Joins the existing `fx-nuke`, `fx-erase`, `fx-power`, `fx-freeze`.

| filename | key | SUBJECT line |
|---|---|---|
| `fx-hot` | `hot` (narration) | a football streaking upward wrapped in a hot green flame trail |
| `fx-cold` | `cold` | a football dulled under a grey frost bloom, the flame beside it guttering out |
| `fx-drip` | `drip` | three fat droplets falling from the tip of a football into a small pooled ring |
| `fx-reset` | `reset` | a mechanical stopwatch snapping back to zero, its needle at the top |
| `fx-stop` | `stop` | a game clock face with a heavy pause bar clamped across it |
| `fx-compression` | `compression` | a bench vice squeezing a football out of round |
| `fx-mult` | `mult` | a quarterback's raised arm cocked to throw with a small amber multiplier burst at the elbow |
| `fx-backup` | `backup` | a life ring with a football sitting in its centre hole |
| `fx-counter` | `counter` (moment) | a football rebounding off a riot shield, arrow bending back |
| `fx-shutdown` | `shutdown` | a padlocked end-zone pylon, the pylon dark and the lock bright |
| `fx-carrywipe` | `carrywipe` | a running back's cleat scraping a chalk line off the turf, dust kicking up |
| `fx-tenuke` | `tenuke` | a scoreboard digit panel collapsing downward, a red arrow plunging through it |
| `fx-flip` | `flip` | a coin caught mid-flip, one face green and one face red |
| `fx-walkoff` | `walkoff` | a stadium klaxon light on its post, amber lens lit, tilted |
| `fx-photo` | `photo` | an old press camera with a football-shaped lens hood and a small flash burst |

## Tier 3 — UI chrome (65)

**These need code work before they can be used** — see the last section of
`audit.md`. Generate them, but budget for the refactor. Add each name to
`UI_ART`, alongside the existing `ui-rulebook`, `ui-admin`, `ui-scout`,
`ui-liveboard`.

### Navigation & league hub

| filename | replaces | SUBJECT line |
|---|---|---|
| `ui-home` | 🏠 | a small stadium seen head-on as a squat rounded home shape, floodlight masts on top |
| `ui-chat` | 💬 | a rounded speech bubble stitched like a football, laces across its face |
| `ui-draft` | ⛏ | a pickaxe with a worn wooden haft and a chalk-dusted steel head |
| `ui-teams` | 👥 | three helmets in a row, front one green, staggered back |
| `ui-register` | 📜 | a rolled ledger scroll partly unfurled, ruled lines suggested not drawn |
| `ui-recruit` | 📣 | a hand megaphone tilted upward, amber mouth |
| `ui-alerts` | 🔔 | a heavy referee's handbell mid-swing with two short sound ticks |
| `ui-roster-settings` | 🧢 | a coach's ball cap seen three-quarter, brim forward |
| `ui-trophy` | 🏆 | a two-handled championship cup with a football set in the bowl |
| `ui-crown` | 👑 | a stout five-point crown resting at an angle on a football |
| `ui-schedule` | 📅 | a tear-off desk calendar block, top sheet curling |
| `ui-gamelog` | 📺 | a boxy retro TV with a football on the screen, antenna up |
| `ui-shop` | 🛒 | a small shopping basket with a football and a power-up card sticking out |
| `ui-rules` | 📖 | an open playbook, spiral-bound, a single X-and-O route suggested |
| `ui-faq` | ❓ | a question mark cut from a football panel, leather grain and one lace |

### Commissioner & admin

| filename | replaces | SUBJECT line |
|---|---|---|
| `ui-settings` | ⚙ | a heavy toothed cog with a football pattern pressed into its hub |
| `ui-scoring` | ⚖ | a balance scale with a football in one pan and a stack of chips in the other |
| `ui-roster` | 🧩 | four interlocking puzzle tiles forming a square, one tile green and lifted |
| `ui-mode` | 🎮 | a chunky game controller with a football-shaped grip |
| `ui-dynasty` | 🏰 | a squat crenellated stone keep with a pennant |
| `ui-swap` | 🔁 | two thick arrows chasing each other in a closed loop around a small football |
| `ui-faab` | 💰 | a drawstring money sack with a football pattern, coins spilling |
| `ui-pot` | 🪙 | a stack of three thick gold coins, the top one face-on with a football struck into it |
| `ui-waivers` | ⏳ | an hourglass with pigskin-brown sand mid-fall |
| `ui-quiet-hours` | 🌙 | a crescent moon over a darkened stadium floodlight mast |
| `ui-daily-time` | 🕒 | a round analogue wall clock, hands at three, thick bezel |
| `ui-live-test` | 🧪 | a lab flask with green fluid and a football suspended in it |
| `ui-reseed` | 🧬 | a double helix built from tiny footballs |
| `ui-view-as` | 👁 | a single wide-open eye with a football-shaped iris |
| `ui-browse-as` | 🌐 | a wireframe globe with a football panel seam running through it |
| `ui-invite-link` | ⛓ | two heavy interlocking chain links, one green |
| `ui-send-invite` | ✉ | a sealed envelope with a football-shaped wax seal |
| `ui-delete` | 🗑 | a dented metal waste bin with the lid lifting off |
| `ui-cut` | ✂ | a pair of heavy shears cutting a jersey strip |
| `ui-edit` | ✏️ | a stubby carpenter's pencil, sharpened, laid at an angle |
| `ui-identity` | 🏷 | a hanging luggage tag with a string, blank face |
| `ui-team-art` | 🖼 | a framed team crest shield on a small easel |
| `ui-gif` | 🖼 (chat) | a stack of two photo frames with a small play triangle on the top one |
| `ui-players` | 🧑 | a single blank jersey on a hanger, number panel empty |
| `ui-ai` | 🤖 | a boxy robot head with a football-seam faceplate and two lens eyes |
| `ui-human` | 👤 | a plain helmet in silhouette, three-quarter, no facemask detail |
| `ui-save` | 💾 | a floppy disk with a football embossed on the shutter |
| `ui-blocked` | 🚫 | a heavy circular prohibition ring, thick bar across, worn paint |
| `ui-immune` | 🛡 | a kite shield with a football boss at its centre, a light rim |

### Draft room

| filename | replaces | SUBJECT line |
|---|---|---|
| `ui-on-clock` | ⏱ | a handheld coach's stopwatch with a crown button, hand sweeping |
| `ui-randomize` | 🎲 | two dice tumbling, pips replaced by tiny footballs |
| `ui-pace-slow` | 🐢 | a tortoise with a football-panel shell, plodding |
| `ui-pace-max` | 🕶 | a pair of blocky wraparound sunglasses, dark lenses, bright frame |

### Board & matchup

| filename | replaces | SUBJECT line |
|---|---|---|
| `ui-football` | 🏈 | a classic leather football on its point, white laces, worn grain |
| `ui-locked` | 🔒 | a fat closed padlock, shackle down, a football seam on the body |
| `ui-unlocked` | 🔓 | the same fat padlock sprung open, shackle swung clear, amber body |
| `ui-cards` | 🃏 | three fanned playing-card backs with a football motif on the top card |
| `ui-skull` | ☠ | a blunt stylised skull wearing a cracked helmet |
| `ui-best-ball` | 🎯 | a target with a football embedded dead centre |
| `ui-battle` | ⚔ | two crossed short swords behind a small football |
| `ui-mvp` | ⭐ | a five-point star medal with a football at its heart, short ribbon |
| `ui-warning` | ⚠ | a rounded warning triangle in amber with a heavy dark bar in the middle |
| `ui-stadium` | 🏟 | a stadium bowl seen from three-quarters, roof ring open over the pitch |
| `ui-spy` | 👁️ | a pair of binoculars with football-panel barrels |

### Chat & social

| filename | replaces | SUBJECT line |
|---|---|---|
| `ui-poll` | 📊 | three bar-chart columns of differing height, tallest in green |
| `ui-pin` | 📌 | a fat push-pin at a three-quarter angle, bright head |
| `ui-interest` | 👀 | two side-by-side wide eyes peering over a low edge |
| `ui-filter` | 🔎 | a funnel with a football dropping into its mouth |
| `ui-update` | ⬆ | a fat upward chevron arrow on a rounded plate, green |
| `ui-autofill` | ✨ | a magic wand tipped with a small football, three sparks |

---

## Consistency checklist before you accept a batch

Generate a few, put them side by side, and only carry on when all of these hold:

- [ ] Same apparent scale — objects fill the frame equally; no icon reads noticeably smaller
- [ ] Same light direction (upper left) across every icon
- [ ] Same contour weight and warmth
- [ ] Alpha is genuinely transparent, not white
- [ ] Legible at 16 px — downscale and squint
- [ ] Readable on both `#252116` and `#EFEADD`
- [ ] No lettering, numbers, or real team marks anywhere

## Regenerating a single icon later

Reuse the style block verbatim and add the new subject line, then append:

> Match the shading, contour weight, palette and apparent scale of the reference
> image exactly. Same light direction, same material finish.

…and attach an existing `factory` PNG as the reference. Gemini holds style far
better with an image reference than from the text description alone.
