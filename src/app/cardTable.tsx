// Card-table theme kit — the card-game presentation of the live board, gated
// per league by league_pref.card_theme (super-admin toggle, migration 0074).
// Purely presentational: cards render from the same picks/pool/scores the
// classic board uses. All CSS is scoped under .ctable so nothing leaks into
// the rest of the app; suit colors come from the active theme's --pos-* vars.
import { useEffect, useMemo, useState } from 'react';
import { headshot } from '../data/media';
import { PuIcon } from './gameIcons';

const FONT_URL = `${import.meta.env.BASE_URL}fonts/lilita-one.woff2`;

const CSS = `
@font-face{font-family:'Lilita One';font-style:normal;font-weight:400;font-display:swap;src:url('${FONT_URL}') format('woff2');}
/* Dark felt: a green baize whose base + ambient glow lean slightly toward the
   active theme (base nudged toward --bg, blobs tinted --you / --opp) so neon
   reads teal, prime warm, slate cool — without losing the felt-green heart. */
.ctable{position:relative;border-radius:12px;overflow:hidden;padding:12px 10px 16px;
  background:color-mix(in srgb, #0B1F1A 80%, var(--bg, #0B1F1A));}
.ctable .ct-blobs{position:absolute;inset:-30%;pointer-events:none;}
.ctable .ct-blob{position:absolute;width:60%;height:60%;border-radius:50%;filter:blur(60px);opacity:.5;mix-blend-mode:screen;}
.ctable .ct-b1{background:radial-gradient(circle,color-mix(in srgb, var(--you, #36E59B) 40%, #0B1F1A) 0%,transparent 62%);top:0;left:-5%;animation:ct-drift 39s linear infinite;}
.ctable .ct-b2{background:radial-gradient(circle,color-mix(in srgb, var(--opp, #FF5266) 38%, #0B1F1A) 0%,transparent 60%);bottom:-8%;right:-5%;animation:ct-drift 51s linear infinite reverse;}
@keyframes ct-drift{from{transform:rotate(0) translateX(8%) rotate(0)}to{transform:rotate(360deg) translateX(8%) rotate(-360deg)}}
.ctable .ct-vig{position:absolute;inset:0;pointer-events:none;background:radial-gradient(120% 90% at 50% 40%,transparent 55%,rgba(0,0,0,.55) 100%);}
.ctable .ct-body{position:relative;}
.ctable .ct-disp{font-family:'Lilita One',ui-rounded,system-ui,sans-serif;font-weight:400;text-transform:uppercase;letter-spacing:.05em;
  text-shadow:-1.2px -1.2px 0 #14100A,1.2px -1.2px 0 #14100A,-1.2px 1.2px 0 #14100A,1.2px 1.2px 0 #14100A,0 3px 0 #14100A;}

.ctable .ct-pod{border:2px solid rgba(0,0,0,.75);border-radius:12px;padding:9px 8px 11px;margin-bottom:12px;
  background:linear-gradient(rgba(10,26,21,.55),rgba(8,20,16,.72));
  box-shadow:inset 0 0 0 1px rgba(233,185,89,.09),inset 0 12px 20px rgba(0,0,0,.35),0 3px 0 rgba(0,0,0,.55);}
.ctable .ct-podhead{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;}
.ctable .ct-duel{display:grid;grid-template-columns:1fr auto 1fr;gap:8px;align-items:start;}
.ctable .ct-col{display:flex;flex-direction:column;gap:9px;align-items:center;min-width:0;}
.ctable .ct-mid{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;padding-top:34px;min-width:46px;}

.ctable .ct-wrap{width:104px;height:150px;perspective:700px;position:relative;}
.ctable .ct-card{position:relative;width:100%;height:100%;transform-style:preserve-3d;
  animation:ct-wob var(--wobdur,4.8s) ease-in-out var(--wobdel,0s) infinite alternate;}
@keyframes ct-wob{from{transform:rotateZ(-.9deg) translateY(0)}to{transform:rotateZ(.9deg) translateY(-2px)}}
.ctable .ct-dealin{animation:ct-deal .5s cubic-bezier(.3,1.5,.5,1) backwards;}
@keyframes ct-deal{from{transform:translateY(-40px) rotateZ(8deg);opacity:0}to{transform:translateY(0) rotateZ(0);opacity:1}}
.ctable .ct-flip .ct-card{animation:ct-flipin .55s cubic-bezier(.3,1.4,.5,1) backwards,
  ct-wob var(--wobdur,4.8s) ease-in-out var(--wobdel,0s) infinite alternate;}
@keyframes ct-flipin{from{transform:rotateY(180deg)}to{transform:rotateY(0)}}
.ctable .ct-side{position:absolute;inset:0;border-radius:10px;border:2px solid #000;overflow:hidden;box-shadow:0 4px 0 rgba(0,0,0,.7);}
.ctable .ct-face{color:#201C12;display:flex;flex-direction:column;padding:6px;isolation:isolate;
  background-image:radial-gradient(rgba(184,134,59,.12) 1px,transparent 1.2px),radial-gradient(circle at 50% 36%,#FDF8E9 0%,#F4EDDA 55%,#E2D5B6 100%);
  background-size:11px 11px,100% 100%;}
.ctable .ct-face>*{position:relative;z-index:1;}
.ctable .ct-fill{position:absolute;left:0;right:0;bottom:0;height:0%;z-index:0;pointer-events:none;
  background:linear-gradient(rgba(233,185,89,0),rgba(233,185,89,.38) 18%,rgba(222,160,50,.5));
  border-top:2px solid rgba(184,134,59,.85);transition:height .7s cubic-bezier(.3,1.4,.5,1);}
.ctable .ct-opp .ct-fill{background:linear-gradient(rgba(255,90,95,0),rgba(255,90,95,.30) 18%,rgba(210,70,80,.42));border-top-color:rgba(178,58,68,.85);}
.ctable .ct-bank{display:flex;justify-content:center;align-items:baseline;gap:3px;padding:2px 0 0;font-variant-numeric:tabular-nums;}
.ctable .ct-bank b{font-family:'Lilita One',ui-rounded,system-ui,sans-serif;font-weight:400;font-size:15px;color:#1E1809;line-height:1;}
.ctable .ct-bank span{font-size:7px;color:#9A8E6E;letter-spacing:.1em;}
.ctable .ct-tap{cursor:pointer;}
.ctable .ct-tap:hover .ct-card{translate:0 -3px;}
.ctable .ct-sel .ct-side{outline:3px solid #E9B959;outline-offset:2px;}
.ctable .ct-curchip{position:absolute;top:-8px;left:50%;transform:translateX(-50%);z-index:6;background:#E9B959;color:#241A08;
  border:2px solid #000;border-radius:999px;font-size:7.5px;font-weight:800;letter-spacing:.06em;padding:2.5px 7px;box-shadow:0 2px 0 #000;white-space:nowrap;}
.ctable .ct-lockovl{position:absolute;inset:0;z-index:5;display:flex;align-items:center;justify-content:center;font-size:22px;
  background:rgba(20,14,6,.35);border-radius:8px;}
.ctable .ct-hot .ct-face{box-shadow:inset 0 0 14px 1px rgba(233,185,89,.45);}
.ctable .ct-hot .ct-side{box-shadow:0 4px 0 rgba(0,0,0,.7),0 0 14px 2px rgba(233,185,89,.5);}
.ctable .ct-hotchip{position:absolute;top:-8px;right:-7px;z-index:5;background:#FF7B3B;border:2px solid #000;border-radius:999px;
  font-size:8px;font-weight:800;color:#2A1204;padding:3px 6px;box-shadow:0 2px 0 #000;}
.ctable .ct-nuked .ct-card{animation:none;filter:saturate(.55);}
.ctable .ct-scorch{position:absolute;inset:0;z-index:4;border-radius:8px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;
  background:radial-gradient(circle at 52% 44%,rgba(20,10,4,.92) 0%,rgba(24,12,5,.85) 52%,rgba(30,14,6,.45) 78%,transparent 100%);}
.ctable .ct-scorch .ct-skull{font-size:18px;}
.ctable .ct-scorch .ct-sup{font-family:'Lilita One',ui-rounded,system-ui,sans-serif;font-size:10px;color:#FF9B76;letter-spacing:.06em;
  text-shadow:-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000,1px 1px 0 #000;}
.ctable .ct-scorch .ct-wiped{font-size:8px;color:#D8C9BD;font-variant-numeric:tabular-nums;}
.ctable .ct-facehead{display:flex;justify-content:space-between;align-items:center;}
.ctable .ct-suit{font-size:8px;font-weight:800;letter-spacing:.06em;padding:2.5px 5px;border-radius:4px;border:1.5px solid;}
.ctable .ct-slot{font-size:7px;color:#6E6650;letter-spacing:.1em;}
.ctable .ct-art{align-self:center;margin-top:4px;width:72px;height:52px;border-radius:7px;border:2px solid;overflow:hidden;position:relative;
  background:radial-gradient(circle at 50% 20%,#FFF 0%,#E8E0C8 100%);display:flex;align-items:center;justify-content:center;}
.ctable .ct-art img{width:100%;height:100%;object-fit:cover;object-position:top;display:block;}
.ctable .ct-mono{font-family:'Lilita One',ui-rounded,system-ui,sans-serif;font-size:17px;}
.ctable .ct-name{text-align:center;font-family:'Lilita One',ui-rounded,system-ui,sans-serif;font-size:9.4px;letter-spacing:.04em;line-height:1.18;
  margin-top:5px;color:#2A2312;text-transform:uppercase;text-wrap:balance;}
.ctable .ct-metric{margin-top:auto;text-align:center;font-size:6.6px;letter-spacing:.1em;color:#6E6650;padding-bottom:2px;}
.ctable .ct-metric b{display:inline-block;padding:2px 5px;border-radius:4px;background:#241C10;color:#E9B959;font-size:7px;letter-spacing:.1em;max-width:88px;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:bottom;}

.ctable .ct-back{background:radial-gradient(circle at 50% 46%,#7E2430 0%,#571C26 62%,#40151E 100%);}
.ctable .ct-lattice{position:absolute;inset:6px;border:1.5px solid rgba(233,185,89,.5);border-radius:6px;
  background-image:radial-gradient(rgba(233,185,89,.34) 1.1px,transparent 1.3px);background-size:11px 11px;}
.ctable .ct-gem{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:26px;color:#E9B959;text-shadow:0 2px 0 #000;}
.ctable .ct-sealtag{position:absolute;left:50%;bottom:9px;transform:translateX(-50%) rotate(-3deg);font-size:6.4px;letter-spacing:.16em;
  background:#2A0E13;color:#D9A0A6;border:1px solid rgba(233,185,89,.4);padding:2.5px 6px;border-radius:3px;white-space:nowrap;}

.ctable .ct-coltag{font-size:8px;letter-spacing:.22em;opacity:.65;font-weight:700;}
.ctable .ct-winlab{font-size:8px;letter-spacing:.16em;color:#93A594;font-weight:700;}
.ctable .ct-state{font-size:8px;letter-spacing:.14em;font-weight:700;padding:3px 8px;border-radius:999px;border:1.5px solid #000;box-shadow:0 2px 0 #000;}
.ctable .ct-state.sealed{background:#2A2216;color:#CDB77F;}
.ctable .ct-state.live{background:#E9B959;color:#241A08;animation:ct-livepulse 1.6s infinite;}
.ctable .ct-state.final{background:#1C2B22;color:#8FCDA4;}
@keyframes ct-livepulse{0%,100%{box-shadow:0 2px 0 #000,0 0 0 0 rgba(233,185,89,.5)}50%{box-shadow:0 2px 0 #000,0 0 0 7px rgba(233,185,89,0)}}
.ctable .ct-bigpts{font-family:'Lilita One',ui-rounded,system-ui,sans-serif;font-weight:400;font-variant-numeric:tabular-nums;
  text-shadow:-1.5px -1.5px 0 #000,1.5px -1.5px 0 #000,-1.5px 1.5px 0 #000,1.5px 1.5px 0 #000,0 3px 0 #000;}
.ctable .ct-score{font-family:'Lilita One',ui-rounded,system-ui,sans-serif;font-size:15px;font-variant-numeric:tabular-nums;
  text-shadow:-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000,1px 1px 0 #000,0 2px 0 #000;}
.ctable .ct-vs{font-family:'Lilita One',ui-rounded,system-ui,sans-serif;font-size:12px;color:#71806F;
  text-shadow:-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000,1px 1px 0 #000;}

@media (prefers-reduced-motion: reduce){
  .ctable .ct-card,.ctable .ct-blob{animation:none;}
  .ctable .ct-dealin{animation:none;}
}
@media (max-width:400px){ .ctable .ct-wrap{width:92px;height:136px} .ctable .ct-art{width:62px;height:45px} .ctable .ct-mid{min-width:40px} }

/* ── hero-board skin (Matchup.tsx) — felt + card-ified slot boxes. The mx-*
   hooks are inert outside a .ctable ancestor, so DemoBoard/LivePicks reuse of
   SetupRow is untouched. !important is required to beat the board's inline
   styles; state variants (apply-mode / selected → .mx-state) opt out so the
   warn/target highlights keep winning. ───────────────────────────────────── */
.mx-felt{position:relative;}
.mx-felt>*{position:relative;z-index:1;}
.mx-felt .ct-feltlayers{position:absolute;inset:0;z-index:0;pointer-events:none;
  background:
    radial-gradient(70% 60% at 18% 8%, color-mix(in srgb, var(--you, #36E59B) 34%, transparent), transparent 62%),
    radial-gradient(60% 55% at 85% 92%, color-mix(in srgb, var(--opp, #FF5266) 30%, transparent), transparent 60%),
    radial-gradient(55% 60% at 55% 45%, color-mix(in srgb, var(--warn, #14424A) 26%, transparent), transparent 65%),
    color-mix(in srgb, #0B1F1A 80%, var(--bg, #0B1F1A));}
.mx-felt .ct-feltlayers::before{content:"";position:absolute;inset:0;opacity:.5;mix-blend-mode:overlay;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2'/%3E%3CfeColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 .5 0'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)'/%3E%3C/svg%3E");}
.mx-felt .ct-feltlayers::after{content:"";position:absolute;inset:0;background:radial-gradient(120% 90% at 50% 40%,transparent 55%,rgba(0,0,0,.5) 100%);}

@keyframes mx-wob{from{transform:rotate(.7deg)}to{transform:rotate(-.8deg) translateY(-2px)}}
.ctable .mx-winsec{border:2px solid rgba(0,0,0,.75);border-radius:12px;padding:10px 10px 12px;
  background:linear-gradient(rgba(10,26,21,.5),rgba(8,20,16,.65));
  box-shadow:inset 0 0 0 1px rgba(233,185,89,.08),inset 0 12px 20px rgba(0,0,0,.3),0 3px 0 rgba(0,0,0,.5);}
/* Paired setup cards share one width + one min-height; the SetupRow's grid is
   align-items:stretch, so a filled spot (taller content) pulls its sealed /
   empty partner to the SAME height — and a plain empty↔sealed pair matches at
   the min-height. (aspect-ratio fought stretch and content-sized each side,
   which is what made the empty box tower over the sealed card.) */
.ctable .mx-sealed{
  width:100%;max-width:172px;min-height:250px !important;justify-self:center;box-sizing:border-box;
  background-image:radial-gradient(rgba(233,185,89,.32) 1.1px,transparent 1.3px),radial-gradient(circle at 50% 46%,#7E2430 0%,#571C26 62%,#40151E 100%) !important;
  background-size:11px 11px,100% 100% !important;
  border:2px solid #000 !important;border-right:2px solid #000 !important;
  border-radius:10px !important;box-shadow:0 4px 0 rgba(0,0,0,.6);
  animation:mx-wob 5.4s ease-in-out infinite alternate;}
.ctable .mx-sealed .grotesk{color:#E9B959 !important;text-shadow:0 2px 0 #000;font-size:26px !important;}
.ctable .mx-sealed .mono{color:#E3B7BC !important;}
.ctable .mx-empty:not(.mx-state){
  width:100%;max-width:172px;min-height:250px !important;justify-self:center;box-sizing:border-box;
  background:rgba(233,185,89,.05) !important;
  border:2px dashed rgba(233,185,89,.55) !important;border-left:2px dashed rgba(233,185,89,.55) !important;
  border-radius:10px !important;}
.ctable .mx-spot:not(.mx-state){
  width:100%;max-width:172px;min-height:250px !important;justify-self:center;box-sizing:border-box;
  border:2px solid #000 !important;border-left:2px solid #000 !important;border-top:4px solid var(--you) !important;
  border-radius:10px !important;box-shadow:0 4px 0 rgba(0,0,0,.55);
  animation:mx-wob 6.2s ease-in-out infinite alternate;}
/* Card-face layout inside a filled spot: cream card stock (same as PlayerCard),
   headshot stacked over a centered Lilita name, metric as the dark gold chip —
   the setup box reads as a portrait player card in every app theme. */
.ctable .mx-spot:not(.mx-state){
  background-image:radial-gradient(rgba(184,134,59,.12) 1px,transparent 1.2px),radial-gradient(circle at 50% 36%,#FDF8E9 0%,#F4EDDA 55%,#E2D5B6 100%) !important;
  background-size:11px 11px,100% 100% !important;}
.ctable .mx-hidden{display:none !important;}
.ctable .mx-spot:not(.mx-state) .mx-id{flex-direction:column;align-items:center;padding-right:0 !important;margin-top:auto;}
.ctable .mx-spot:not(.mx-state) .mx-idbtn{flex-direction:column;align-items:center;text-align:center;gap:6px !important;flex:none !important;}
.ctable .mx-spot:not(.mx-state) .mx-idbtn>div{text-align:center;}
.ctable .mx-spot:not(.mx-state) .mx-idbtn .grotesk{color:#2A2312 !important;font-family:'Lilita One',ui-rounded,system-ui,sans-serif;
  font-weight:400 !important;letter-spacing:.04em;text-transform:uppercase;font-size:12px !important;white-space:normal !important;text-wrap:balance;}
.ctable .mx-spot:not(.mx-state) .mx-idbtn .mono{color:#6E6650 !important;}
.ctable .mx-spot:not(.mx-state) .mx-met{justify-content:center;text-align:center;}
.ctable .mx-spot:not(.mx-state) .mx-met .grotesk{background:#241C10;color:#E9B959 !important;padding:2.5px 8px;border-radius:4px;
  font-size:10px !important;letter-spacing:.06em;}
.ctable .mx-spot:not(.mx-state) .mx-met .mono{color:#6E6650 !important;}
@media (prefers-reduced-motion:reduce){.ctable .mx-sealed,.ctable .mx-spot:not(.mx-state){animation:none;}}

/* ── live ScoreCards (Matchup live/final phase) — dark card stock so the
   dense light-on-dark live info + you/opp accents stay readable, plus a
   compact size so the log + field get more room. CSS-only over ScoreCard's
   mx-sc-* hooks; inert off the felt. Accent spine (inline borderLeft/Right)
   is preserved. ─────────────────────────────────────────────────────────── */
.ctable .mx-scorecard{
  background-image:radial-gradient(rgba(233,185,89,.08) 1px,transparent 1.2px),radial-gradient(circle at 50% 34%,#2C2417 0%,#241C11 55%,#1C150C 100%) !important;
  background-size:11px 11px,100% 100% !important;
  border-radius:10px !important;box-shadow:0 4px 0 rgba(0,0,0,.5) !important;
  padding:6px 9px !important;}
/* Compact: shrink the headshot + big number so a live row is tighter. */
.ctable .mx-sc-img,.ctable .mx-sc-img>*{width:36px !important;height:36px !important;}
.ctable .mx-sc-img img,.ctable .mx-sc-img>*>*{width:36px !important;height:36px !important;object-fit:cover;}
.ctable .mx-sc-big{font-size:20px !important;}
@media (min-width:760px){
  .ctable .mx-sc-img,.ctable .mx-sc-img>*{width:46px !important;height:46px !important;}
  .ctable .mx-sc-img img,.ctable .mx-sc-img>*>*{width:46px !important;height:46px !important;}
  .ctable .mx-sc-big{font-size:22px !important;}
}

/* ── power-up cards (shop + apply modals) — the hand's leather stock, dealt
   as a tappable grid on the felt ─────────────────────────────────────────── */
.ctable .ct-puwrap{width:150px;position:relative;animation:ct-deal .5s cubic-bezier(.3,1.5,.5,1) backwards;}
.ctable .ct-pucard{display:flex;flex-direction:column;width:100%;min-height:196px;border-radius:10px;border:2px solid #000;
  box-shadow:0 4px 0 rgba(0,0,0,.7);
  background-image:radial-gradient(rgba(233,185,89,.09) 1px,transparent 1.2px),radial-gradient(circle at 50% 38%,#332919 0%,#2A2115 55%,#201810 100%);
  background-size:11px 11px,100% 100%;
  padding:9px 8px;color:#EFE4C8;cursor:pointer;transition:translate .2s;text-align:center;}
.ctable .ct-puwrap:not(.ct-pudis):hover .ct-pucard{translate:0 -3px;}
.ctable .ct-pudis .ct-pucard{filter:grayscale(.6) brightness(.65);cursor:default;}
.ctable .ct-putime{align-self:center;font-size:8px;font-weight:800;letter-spacing:.12em;padding:2.5px 7px;border-radius:999px;
  border:1.5px solid #000;box-shadow:0 1.5px 0 #000;background:#2A2216;color:#CDB77F;}
.ctable .ct-putime.live{background:#E9B959;color:#241A08;}
.ctable .ct-puico{font-size:28px;line-height:1;margin:8px 0 3px;}
.ctable .ct-puname{font-family:'Lilita One',ui-rounded,system-ui,sans-serif;font-size:12px;letter-spacing:.05em;text-transform:uppercase;
  line-height:1.2;text-shadow:-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000,1px 1px 0 #000;text-wrap:balance;}
.ctable .ct-publurb{font-size:9.2px;line-height:1.5;color:#CFC4A6;margin-top:5px;display:-webkit-box;-webkit-line-clamp:4;
  -webkit-box-orient:vertical;overflow:hidden;}
.ctable .ct-punote{font-size:8.6px;color:#E0A96B;margin-top:4px;line-height:1.4;}
.ctable .ct-pucost{margin-top:auto;padding-top:7px;}
.ctable .ct-pucost b{display:inline-block;font-family:'Lilita One',ui-rounded,system-ui,sans-serif;font-weight:400;font-size:11px;
  letter-spacing:.06em;text-transform:uppercase;color:#241A08;background:linear-gradient(#F0C367,#DFA83F);
  border:2px solid #000;border-radius:7px;box-shadow:0 2.5px 0 #000;padding:5px 12px;}
.ctable .ct-pudis .ct-pucost b{background:#3A3226;color:#8C8270;}
.ctable .ct-puown{position:absolute;top:-7px;right:-6px;z-index:5;background:#E9B959;color:#241A08;border:2px solid #000;
  border-radius:999px;font-size:8px;font-weight:800;padding:2px 6px;box-shadow:0 2px 0 #000;}
.ctable .ct-puflash .ct-pucard{outline:3px solid #E9B959;outline-offset:2px;}

/* ── the power-up hand (standalone — renders outside .ctable too) ─────────── */
.ct-hand{position:fixed;left:50%;transform:translateX(-50%);bottom:-6px;z-index:40;width:min(500px,100vw);height:128px;pointer-events:none;}
.ct-hand .ct-handtag{position:absolute;bottom:100px;left:50%;transform:translateX(-50%);font-size:8px;letter-spacing:.24em;
  color:var(--dim);opacity:.9;pointer-events:none;font-weight:700;}
.ct-hcard{position:absolute;bottom:0;left:50%;width:78px;height:106px;pointer-events:auto;cursor:pointer;
  transform:translateX(calc(-50% + var(--hx))) rotate(var(--hr)) translateY(46px);
  transition:transform .3s cubic-bezier(.3,1.6,.4,1),filter .3s;}
.ct-hcard .ct-hinner{width:100%;height:100%;border-radius:9px;border:2px solid #000;box-shadow:0 5px 0 rgba(0,0,0,.7);
  background-image:radial-gradient(rgba(233,185,89,.09) 1px,transparent 1.2px),radial-gradient(circle at 50% 38%,#332919 0%,#2A2115 55%,#201810 100%);
  background-size:11px 11px,100% 100%;
  padding:6px 6px 7px;display:flex;flex-direction:column;color:#EFE4C8;}
.ct-hcard:hover,.ct-hcard.raised{transform:translateX(calc(-50% + var(--hx))) rotate(0deg) translateY(-12px) scale(1.07);z-index:52;}
.ct-hcard.dim{filter:grayscale(.7) brightness(.6);}
.ct-hcard .ct-hico{font-size:19px;text-align:center;margin-top:2px;line-height:1;}
.ct-hcard .ct-httl{font-family:'Lilita One',ui-rounded,system-ui,sans-serif;font-size:8.6px;text-align:center;margin-top:5px;line-height:1.2;
  letter-spacing:.04em;text-transform:uppercase;text-shadow:-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000,1px 1px 0 #000;}
.ct-hcard .ct-hqty{position:absolute;top:-7px;right:-6px;background:#E9B959;color:#241A08;border:2px solid #000;border-radius:999px;
  font-size:8px;font-weight:800;padding:2px 5px;box-shadow:0 2px 0 #000;}
.ct-hcard .ct-hdl{margin-top:auto;text-align:center;font-size:6.6px;letter-spacing:.08em;color:#CDB77F;line-height:1.3;}
.ct-htip{position:absolute;bottom:calc(100% + 8px);left:50%;transform:translateX(-50%);width:158px;
  background:#100C06;border:2px solid #000;border-radius:8px;box-shadow:0 3px 0 #000;padding:7px 8px;
  font-size:8.6px;line-height:1.45;color:#CFC4A6;text-align:center;}
.ct-htip .ct-hact{display:block;width:100%;margin-top:6px;font-family:'Lilita One',ui-rounded,system-ui,sans-serif;font-size:10px;
  letter-spacing:.06em;text-transform:uppercase;color:#241A08;background:linear-gradient(#F0C367,#DFA83F);
  border:2px solid #000;border-radius:7px;box-shadow:0 3px 0 #000;padding:6px 0;cursor:pointer;}
.ct-htip .ct-hact:active{transform:translateY(2px);box-shadow:0 1px 0 #000;}
.ct-htip .ct-hnote{display:block;margin-top:4px;color:#E0A96B;font-size:8px;}
@media (prefers-reduced-motion: reduce){ .ct-hcard{transition:none;} }

/* ═══ LIGHT APP THEMES (daylight / arctic) ═══════════════════════════════════
   The felt becomes a light baize tinted from the active theme's own accents,
   and the dark-stock cards (power-ups, the hand, live ScoreCards) flip to a
   light tan stock with ink text. The physical cards keep their identity —
   cream player faces and the maroon sealed backs read on both grounds. */
:root[data-card-light="1"] .ctable{
  background:
    radial-gradient(70% 60% at 18% 8%, color-mix(in srgb, var(--you) 20%, transparent), transparent 62%),
    radial-gradient(60% 55% at 85% 92%, color-mix(in srgb, var(--opp) 18%, transparent), transparent 60%),
    radial-gradient(55% 60% at 55% 45%, color-mix(in srgb, var(--warn) 14%, transparent), transparent 65%),
    color-mix(in srgb, var(--bg) 72%, #FFFFFF);}
/* Felt-component blobs: darken the light ground (multiply) instead of glowing. */
:root[data-card-light="1"] .ctable .ct-blob{mix-blend-mode:multiply;opacity:.28;}
:root[data-card-light="1"] .ctable .ct-vig{background:radial-gradient(120% 90% at 50% 40%,transparent 60%,rgba(60,40,20,.16) 100%);}
/* mx-felt (hero board) layered ground + softer vignette. */
:root[data-card-light="1"] .mx-felt .ct-feltlayers{
  background:
    radial-gradient(70% 60% at 18% 8%, color-mix(in srgb, var(--you) 20%, transparent), transparent 62%),
    radial-gradient(60% 55% at 85% 92%, color-mix(in srgb, var(--opp) 18%, transparent), transparent 60%),
    radial-gradient(55% 60% at 55% 45%, color-mix(in srgb, var(--warn) 14%, transparent), transparent 65%),
    color-mix(in srgb, var(--bg) 72%, #FFFFFF);}
:root[data-card-light="1"] .mx-felt .ct-feltlayers::after{background:radial-gradient(120% 90% at 50% 40%,transparent 60%,rgba(60,40,20,.14) 100%);}
:root[data-card-light="1"] .mx-felt .ct-feltlayers::before{opacity:.28;}
/* Window pods: lighter frame on the light table. */
:root[data-card-light="1"] .ctable .mx-winsec,
:root[data-card-light="1"] .ctable .ct-pod{background:linear-gradient(rgba(255,255,255,.5),rgba(255,255,255,.28));
  box-shadow:inset 0 0 0 1px rgba(184,134,59,.22),inset 0 12px 20px rgba(120,90,40,.08),0 3px 0 rgba(120,90,40,.18);}

/* Light tan stock (power-up cards, hand, live ScoreCards) + ink text. */
:root[data-card-light="1"] .ctable .ct-pucard,
:root[data-card-light="1"] .ct-hcard .ct-hinner{
  background-image:radial-gradient(rgba(120,90,40,.13) 1px,transparent 1.2px),radial-gradient(circle at 50% 38%,#F3ECD7 0%,#E9DFC4 55%,#DCCFAC 100%);
  background-size:11px 11px,100% 100%;color:#2A2312;}
:root[data-card-light="1"] .ctable .ct-puname,
:root[data-card-light="1"] .ct-hcard .ct-httl{color:#2A2312;text-shadow:none;}
:root[data-card-light="1"] .ctable .ct-publurb{color:#6E6650;}
:root[data-card-light="1"] .ct-hcard .ct-hdl{color:#7A6E50;}
:root[data-card-light="1"] .ctable .ct-putime{background:#EFE6CF;color:#7A5A1E;}
:root[data-card-light="1"] .ctable .ct-putime.live{background:#E9B959;color:#241A08;}
:root[data-card-light="1"] .mx-scorecard{
  background-image:radial-gradient(rgba(120,90,40,.12) 1px,transparent 1.2px),radial-gradient(circle at 50% 34%,#F3ECD7 0%,#E9DFC4 55%,#DCCFAC 100%) !important;
  box-shadow:0 4px 0 rgba(120,90,40,.2) !important;}
`;

/** Inject the card-table stylesheet once per document. */
export function CardTableCss() {
  useEffect(() => {
    if (document.getElementById('ctable-css')) return;
    const s = document.createElement('style');
    s.id = 'ctable-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  }, []);
  return null;
}

/** The felt table surface: swirling backdrop + vignette around any content. */
export function Felt({ children }: { children: React.ReactNode }) {
  return (
    <div className="ctable">
      <div className="ct-blobs"><div className="ct-blob ct-b1" /><div className="ct-blob ct-b2" /></div>
      <div className="ct-vig" />
      <div className="ct-body">{children}</div>
    </div>
  );
}

// Stable per-card wobble timing so the table doesn't sway in lockstep.
function wobbleVars(seed: string): React.CSSProperties {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return {
    ['--wobdur' as string]: `${(4 + (h % 240) / 100).toFixed(2)}s`,
    ['--wobdel' as string]: `${(-((h >> 8) % 400) / 100).toFixed(2)}s`,
  };
}

const posVars = (pos: string) => {
  const p = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB'].includes(pos) ? pos : 'DEF';
  return { background: `var(--pos-${p}-bg)`, color: `var(--pos-${p}-fg)`, borderColor: `var(--pos-${p}-bd)` };
};

const initials = (name: string) => name.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();

/** A face-up player card: headshot art (monogram when mark-free), suit chip,
 *  slot tag, the hidden-metric chip once revealed, and — when the worker has
 *  published per-slot scores — the drip bank with its liquid fill. Opponent
 *  cards (`opp`) tint red and enter with a reveal flip instead of the deal-in.
 *  `hot` adds the 🔥 glow; `nuked` scorches the card (its bank shows the
 *  post-wipe score). Picker use: pass `onClick` (+ `selected` for the current
 *  pick, `locked` for premium-gated), leave `metric` undefined to hide the
 *  metric row, and pass `badge` (e.g. an injury chip) to sit by the name. */
export function PlayerCard({ slug, name, pos, slot, metric, bank, opp = false, hot = false, nuked = false, idx = 0, onClick, selected = false, locked = false, badge }: {
  slug: string; name: string; pos: string; slot?: string; metric?: string | null;
  bank?: number | null; opp?: boolean; hot?: boolean; nuked?: boolean; idx?: number;
  onClick?: () => void; selected?: boolean; locked?: boolean; badge?: React.ReactNode;
}) {
  const [imgOk, setImgOk] = useState(true);
  const url = useMemo(() => headshot(slug), [slug]);
  const suit = posVars(pos);
  const fillPct = bank != null ? Math.max(0, Math.min(92, bank * 3.2)) : 0;
  return (
    <div className={`ct-wrap ${opp ? 'ct-flip ct-opp' : 'ct-dealin'}${hot && !nuked ? ' ct-hot' : ''}${nuked ? ' ct-nuked' : ''}${selected ? ' ct-sel' : ''}${onClick ? ' ct-tap' : ''}`}
      style={{ animationDelay: `${idx * 90}ms` }} onClick={onClick}>
      <div className="ct-card" style={wobbleVars(slug)}>
        <div className="ct-side ct-face" style={locked ? { filter: 'grayscale(.55) brightness(.75)' } : undefined}>
          <div className="ct-fill" style={{ height: `${fillPct}%` }} />
          <div className="ct-facehead">
            <span className="ct-suit" style={suit}>{pos === 'DEF' ? 'DST' : pos}</span>
            {slot && <span className="ct-slot">{slot.toUpperCase()}</span>}
          </div>
          <div className="ct-art" style={{ borderColor: suit.color as string }}>
            {url && imgOk
              ? <img src={url} alt="" draggable={false} onError={() => setImgOk(false)} />
              : <span className="ct-mono" style={{ color: suit.color as string }}>{initials(name)}</span>}
          </div>
          <div className="ct-name">{name}{badge && <span style={{ marginLeft: 3 }}>{badge}</span>}</div>
          {metric !== undefined && <div className="ct-metric">METRIC <b>{metric ?? '—'}</b></div>}
          {bank != null && <div className="ct-bank"><b>{(Math.round(bank * 10) / 10).toFixed(1)}</b><span>PTS</span></div>}
          {nuked && (
            <div className="ct-scorch">
              <span className="ct-skull">☠</span>
              <span className="ct-sup">NUKED</span>
              {bank != null && <span className="ct-wiped">bank {(Math.round(bank * 10) / 10).toFixed(1)}</span>}
            </div>
          )}
          {locked && <div className="ct-lockovl">🔒</div>}
        </div>
      </div>
      {hot && !nuked && <div className="ct-hotchip">🔥 HOT</div>}
      {selected && <div className="ct-curchip">CURRENT ✓</div>}
    </div>
  );
}

/** A power-up as a tappable card — the shop and apply modals deal these in a
 *  grid on the felt. `cost` renders the gold buy chip; `footLabel` replaces it
 *  (ARM / APPLY / READY in the apply modal). `disabled` dims and mutes the tap. */
export function PowerupCard({ id, name, icon, blurb, timingLabel, live = false, cost, footLabel, owned = 0, disabled = false, note, flashed = false, onClick, idx = 0 }: {
  id: string; name: string; icon?: string; blurb?: string; timingLabel?: string; live?: boolean;
  cost?: number; footLabel?: string; owned?: number; disabled?: boolean; note?: string; flashed?: boolean;
  onClick?: () => void; idx?: number;
}) {
  return (
    <div className={`ct-puwrap${disabled ? ' ct-pudis' : ''}${flashed ? ' ct-puflash' : ''}`}
      style={{ animationDelay: `${idx * 70}ms` }} title={blurb}
      onClick={disabled ? undefined : onClick}>
      <div className="ct-pucard">
        {timingLabel && <span className={`ct-putime${live ? ' live' : ''}`}>{timingLabel}</span>}
        <span className="ct-puico"><PuIcon id={id} emoji={icon} size="1.25em" /></span>
        <span className="ct-puname">{name}</span>
        {blurb && <span className="ct-publurb">{blurb}</span>}
        {note && <span className="ct-punote">↳ {note}</span>}
        <span className="ct-pucost"><b>{footLabel ?? <>◈ {cost}</>}</b></span>
      </div>
      {owned > 0 && <span className="ct-puown">×{owned}</span>}
    </div>
  );
}

/** One power-up in the hand. `action` mirrors the Apply modal's semantics:
 *  'arm' fires immediately (whole-field buff), 'apply' enters tap-a-target
 *  mode, 'hint' is informational (usable in place, e.g. metric unlocks). */
export interface HandCard {
  id: string; name: string; icon?: string; qty: number;
  action: 'arm' | 'apply' | 'hint';
  deadline: string; blurb?: string; note?: string;
}

/** The fanned power-up hand, pinned to the bottom of the screen. Cards you own
 *  (inventory > 0, usable now) peek up from the edge; tapping one raises it
 *  with its tip, and the tip's button ARMs it or enters APPLY target mode.
 *  While a card is pending a target (`pendingId`) it stays raised; tapping it
 *  again cancels. Renders nothing when the hand is empty. */
export function PowerupHand({ cards, pendingId, onArm, onApply, onCancel }: {
  cards: HandCard[]; pendingId: string | null;
  onArm: (id: string) => void; onApply: (id: string) => void; onCancel: () => void;
}) {
  const [raised, setRaised] = useState<string | null>(null);
  useEffect(() => { if (pendingId) setRaised(null); }, [pendingId]);
  if (!cards.length) return null;
  const n = cards.length;
  const spread = Math.min(60, 320 / Math.max(1, n - 1));
  return (
    <div className="ct-hand">
      <div className="ct-handtag">YOUR HAND</div>
      {cards.map((c, i) => {
        const hx = (i - (n - 1) / 2) * spread;
        const hr = (i - (n - 1) / 2) * 4;
        const isPending = pendingId === c.id;
        const isRaised = isPending || raised === c.id;
        const blocked = !!c.note && c.action === 'arm';
        return (
          <div key={c.id}
            className={`ct-hcard${isRaised ? ' raised' : ''}${blocked ? ' dim' : ''}`}
            style={{ ['--hx' as string]: `${hx}px`, ['--hr' as string]: `${hr}deg` }}
            onClick={() => {
              if (isPending) { onCancel(); return; }
              setRaised((r) => (r === c.id ? null : c.id));
            }}>
            <div className="ct-hinner">
              <div className="ct-hico"><PuIcon id={c.id} emoji={c.icon} size="1.2em" /></div>
              <div className="ct-httl">{c.name}</div>
              <div className="ct-hdl">{isPending ? 'TAP TARGET · tap card to cancel' : c.deadline}</div>
            </div>
            {c.qty > 1 && <span className="ct-hqty">×{c.qty}</span>}
            {isRaised && !isPending && (
              <div className="ct-htip" onClick={(e) => e.stopPropagation()}>
                {c.blurb}
                {c.note && <span className="ct-hnote">↳ {c.note}</span>}
                {c.action === 'arm' && !blocked && <button className="ct-hact" onClick={() => { setRaised(null); onArm(c.id); }}>ARM</button>}
                {c.action === 'apply' && <button className="ct-hact" onClick={() => { setRaised(null); onApply(c.id); }}>APPLY → PICK TARGET</button>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** A face-down sealed pick — the opponent's card before its window kicks off. */
export function SealedCard({ seed, idx = 0 }: { seed: string; idx?: number }) {
  return (
    <div className="ct-wrap ct-dealin" style={{ animationDelay: `${idx * 90}ms` }}>
      <div className="ct-card" style={wobbleVars(seed)}>
        <div className="ct-side ct-back">
          <div className="ct-lattice" />
          <div className="ct-gem">◈</div>
          <div className="ct-sealtag">SEALED ◈ PICK</div>
        </div>
      </div>
    </div>
  );
}
