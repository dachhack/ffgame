// 🔊 The web's voice — window.speechSynthesis behind core's `Voice` contract
// (v0.389.0). The reader (core playReader) decides what to say and when;
// this only says it, one utterance at a time, and reports when it is done
// (or failed, or was cut) so the reader never wedges on a silent engine.
//
// WHICH voice (v0.389.1, founder: "Anything more natural?"): browsers ship
// wildly different voices — Edge's "Microsoft … Online (Natural)" set is
// close to a broadcast read, Chrome's "Google US English" is decent, Safari
// has Samantha. `listVoices` offers every English voice, the natural-sounding
// ones first; the pick is remembered; with no pick the best available is used.
import type { Voice } from '@drip/core/data/playReader';

export interface VoiceOption { id: string; label: string; enhanced: boolean; lang: string }
const KEY = 'pbp:voice';
export const hasVoice = (): boolean => typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
const NATURAL = /natural|online|neural|premium|enhanced|google us english|samantha/i;

/** English voices in this browser, most natural first. Voices load lazily in
 *  Chrome — subscribe to `onVoicesChanged` to re-list once they arrive. */
export function listVoices(): VoiceOption[] {
  if (!hasVoice()) return [];
  const all = window.speechSynthesis.getVoices();
  const opts = all.filter((v) => /^en/i.test(v.lang)).map((v) => ({
    id: v.voiceURI, lang: v.lang, enhanced: NATURAL.test(v.name),
    label: v.name.replace(/^(Microsoft|Google)\s+/i, '').replace(/\s*\(.*\)\s*$/, '').replace(/\s+-\s+English.*$/i, '').replace(/\s+Online$/i, '').trim(),
  }));
  opts.sort((a, b) => Number(b.enhanced) - Number(a.enhanced) || Number(/^en-us/i.test(b.lang)) - Number(/^en-us/i.test(a.lang)) || a.label.localeCompare(b.label));
  return opts;
}
export function onVoicesChanged(fn: () => void): () => void {
  if (!hasVoice()) return () => {};
  window.speechSynthesis.addEventListener('voiceschanged', fn);
  return () => window.speechSynthesis.removeEventListener('voiceschanged', fn);
}
export function chosenVoice(): string | null { try { return localStorage.getItem(KEY); } catch { return null; } }
export function chooseVoice(id: string | null): void { try { if (id) localStorage.setItem(KEY, id); else localStorage.removeItem(KEY); } catch { /* private mode */ } }
function pickVoice(): SpeechSynthesisVoice | null {
  const all = window.speechSynthesis.getVoices();
  const chosen = chosenVoice();
  const hit = chosen ? all.find((v) => v.voiceURI === chosen) : null;
  if (hit) return hit;
  const best = listVoices()[0];
  return best ? all.find((v) => v.voiceURI === best.id) ?? null : null;
}

export const webVoice: Voice = {
  speak(text, done) {
    if (!hasVoice()) { done(); return; }
    let called = false;
    const once = () => { if (!called) { called = true; done(); } };
    try {
      const u = new SpeechSynthesisUtterance(text);
      const v = pickVoice();
      if (v) u.voice = v;
      u.lang = v?.lang ?? 'en-US'; u.rate = 1.0;
      u.onend = once; u.onerror = once;
      window.speechSynthesis.speak(u);
    } catch { once(); }
  },
  stop() { if (hasVoice()) { try { window.speechSynthesis.cancel(); } catch { /* nothing to stop */ } } },
};
