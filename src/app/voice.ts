// 🔊 The web's voice — window.speechSynthesis behind core's `Voice` contract
// (v0.389.0). The reader (core playReader) decides what to say and when;
// this only says it, one utterance at a time, and reports when it is done
// (or failed, or was cut) so the reader never wedges on a silent engine.
import type { Voice } from '@drip/core/data/playReader';

export const hasVoice = (): boolean => typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';

export const webVoice: Voice = {
  speak(text, done) {
    if (!hasVoice()) { done(); return; }
    let called = false;
    const once = () => { if (!called) { called = true; done(); } };
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-US'; u.rate = 1.0;
      u.onend = once; u.onerror = once;
      window.speechSynthesis.speak(u);
    } catch { once(); }
  },
  stop() { if (hasVoice()) { try { window.speechSynthesis.cancel(); } catch { /* nothing to stop */ } } },
};
