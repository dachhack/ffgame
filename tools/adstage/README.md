# Ad stage — scripted ad creatives, filmed headlessly

Self-contained animation pages (product palette, card language, brand fonts)
that play a fixed multi-beat timeline at Reddit-native 4:5 (1080×1350), plus a
Playwright shooter that records them to video. This is how the launch ad
creatives were made — no website chrome, every pixel scripted.

- `ad-nuke-real.html.template` — the week-13 Bowers nuke, REAL sim numbers
  (keeps the "real 2025 NFL data" claim).
- `ad-nuke-comeback.html.template` — nuke → blackout lifts → lead flips →
  walk-off TD, 25.7–19.4. Dramatized numbers (no real-data claim).
- `ad-powerup-garbage-time.html.template` — arm 🗑️ Garbage Time pre-kick,
  trail big, ×2 goes live in the final five, win by 0.5. Dramatized.

## Build + shoot
Templates carry `__SG__`/`__LO__` placeholders for the embedded fonts
(Space Grotesk / Lilita One, base64 woff2 — keeps the repo diffable):

```
# fetch fonts (any UA), base64 them, inject:
curl -sA Mozilla "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700" | grep -o 'https://[^)]*woff2' | tail -1 | xargs curl -so sg.woff2
curl -sA Mozilla "https://fonts.googleapis.com/css2?family=Lilita+One" | grep -o 'https://[^)]*woff2' | tail -1 | xargs curl -so lo.woff2
python3 -c "s=open('ad-nuke-comeback.html.template').read(); s=s.replace('__SG__',open('sg.woff2','rb').read().hex() and __import__('base64').b64encode(open('sg.woff2','rb').read()).decode()).replace('__LO__',__import__('base64').b64encode(open('lo.woff2','rb').read()).decode()); open('stage.html','w').write(s)"
node shoot.mjs stage.html out 31000                      # record → out-video/*.webm
node shoot.mjs stage.html out 31000 --shots=14500:nuke   # stills for review
ffmpeg -i out-video/*.webm -c:v libx264 -pix_fmt yuv420p -crf 19 -movflags +faststart -an ad.mp4
```

The timeline lives in each page's `window.__START` (a `setTimeout` scheduler);
beats, copy, players, and scores are plain HTML/JS edits. Change the viewport
in shoot.mjs for 1:1 or 9:16 renders. utm_content naming used so far:
custom-flow-v1 / nuke-comeback-v1 / powerup-garbage-time-v1.
