// 🔊 The app's voice — expo-speech behind core's `Voice` contract (v0.389.0).
//
// The reader (core playReader) decides what to say and when; this only says
// it. One sentence at a time: `speak` resolves `done` when the engine finishes
// (or errors, so a flaky engine never wedges the reader), `stop` cuts it.
import * as Speech from 'expo-speech';
import type { Voice } from '@drip/core/data/playReader';

export const appVoice: Voice = {
  speak(text, done) {
    let called = false;
    const once = () => { if (!called) { called = true; done(); } };
    try {
      Speech.speak(text, { language: 'en-US', rate: 1.0, onDone: once, onStopped: once, onError: once });
    } catch { once(); }
  },
  stop() { try { void Speech.stop(); } catch { /* no engine — nothing to stop */ } },
};
