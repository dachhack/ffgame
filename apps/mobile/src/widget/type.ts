// THE WIDGETS' TYPE FLOOR (v0.712.11). Founder: "do the widgets", the last
// stop of "start on the small fonts". The home-screen widgets ran 7.5–8.5pt
// text, and their frame is fixed by the launcher, so the app's fs() jump
// (8.5 → 11) would overflow it. They get a floor of 9 instead: a step of
// 0.5–1.5pt. A widget TextWidget can't shrink to fit, so every one that
// takes this either carries maxLines (most already did) or is a single word.
export const wfs = (n: number) => Math.max(n, 9);
