// 🔊 The app's voice — expo-speech behind core's `Voice` contract (v0.389.0).
//
// The reader (core playReader) decides what to say and when; this only says
// it. One sentence at a time: `speak` resolves `done` when the engine finishes
// (or errors, so a flaky engine never wedges the reader), `stop` cuts it.
//
// WHICH voice (v0.389.1, founder: "Do we have other voice options? Anything
// more natural?"): Android ships several per language and the Google engine
// marks its network ones Enhanced — noticeably more natural than the default
// on-device one. `listVoices` offers every English voice, Enhanced first;
// the pick is remembered; with no pick, the first Enhanced en-US voice is
// used. What is installed is the phone's (Settings › Text-to-speech).
import * as Speech from 'expo-speech';
import type { Voice } from '@drip/core/data/playReader';
import { storeGet, storeSet } from '@drip/core/platform';

export interface VoiceOption { id: string; label: string; enhanced: boolean; lang: string }
const KEY = 'pbp:voice';
let cache: VoiceOption[] | null = null;

/** English voices on this device, best first. */
export async function listVoices(): Promise<VoiceOption[]> {
  if (cache) return cache;
  try {
    const all = await Speech.getAvailableVoicesAsync();
    const en = all.filter((v) => String(v.language ?? '').toLowerCase().startsWith('en'));
    const opts = en.map((v, i) => ({
      id: v.identifier,
      enhanced: String(v.quality ?? '').toLowerCase() === 'enhanced',
      lang: String(v.language ?? ''),
      label: `${String(v.language ?? 'en').replace('_', '-').toUpperCase()} ${i + 1}`,
    }));
    // Enhanced first, en-US before other Englishes, then stable.
    opts.sort((a, b) => Number(b.enhanced) - Number(a.enhanced) || Number(/^en[-_]us/i.test(b.lang)) - Number(/^en[-_]us/i.test(a.lang)));
    // Number within the sorted list so "EN-US 1" is the best one.
    const seen: Record<string, number> = {};
    for (const o of opts) { const k = o.lang.replace('_', '-').toUpperCase(); seen[k] = (seen[k] ?? 0) + 1; o.label = `${k} ${seen[k]}${o.enhanced ? ' ★' : ''}`; }
    cache = opts;
  } catch { cache = []; }
  return cache;
}
export function chosenVoice(): string | null { return storeGet(KEY) || null; }
export function chooseVoice(id: string | null): void { storeSet(KEY, id ?? ''); }
async function voiceId(): Promise<string | undefined> {
  const chosen = chosenVoice();
  const opts = await listVoices();
  if (chosen && opts.some((o) => o.id === chosen)) return chosen;
  return opts[0]?.id; // best available, or the engine's default
}

export const appVoice: Voice = {
  speak(text, done) {
    let called = false;
    const once = () => { if (!called) { called = true; done(); } };
    voiceId().then((voice) => {
      try {
        Speech.speak(text, { language: 'en-US', rate: 1.0, voice, onDone: once, onStopped: once, onError: once });
      } catch { once(); }
    }).catch(once);
  },
  stop() { try { void Speech.stop(); } catch { /* no engine — nothing to stop */ } },
};
