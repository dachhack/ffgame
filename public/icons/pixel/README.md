# Pixel Bowl sprite slot

Drop the retro sprites here — same filenames as `../factory/`. Any sprite
that's missing simply falls back to the classic emoji at runtime, so the set
can be filled in piecemeal.

Spec: PNG with transparent background, 32×32 native (or 64×64 for @2x —
they render at 12–28 px inline). Must read on both dark (#252116) and light
(#EFEADD) theme grounds.

Required filenames (31):

Power-ups
- pu-metric-swap.png     pu-player-swap.png      pu-extra-slot.png
- pu-return-yards.png    pu-carries-wipe.png     pu-combo-drip.png
- pu-air-raid.png        pu-trick-play.png       pu-pick-six.png
- pu-hail-mary.png       pu-momentum.png         pu-garbage-time.png
- pu-overtime.png        pu-ot-shield.png        pu-insurance.png
- pu-double-or-nothing.png  pu-spy.png           pu-mulligan.png
- pu-emp.png             pu-ball-hawk.png

Live events
- fx-nuke.png            fx-erase.png            fx-power.png
- fx-freeze.png

Coin & brand
- coin-gold.png          coin-silver.png         brand-mark.png

UI buttons
- ui-rulebook.png        ui-admin.png            ui-scout.png
- ui-liveboard.png
