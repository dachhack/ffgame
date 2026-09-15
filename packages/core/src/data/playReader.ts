// 🔊 THE READER — which plays to say, and when (v0.389.0).
//
// One state machine for both hosts, with the voice injected: the app hands it
// expo-speech, the web hands it window.speechSynthesis. Two ways in:
//   · CATCH UP — from the top of the game (or where you last stopped) to the
//     present, one play after another; when it reaches the present it keeps
//     going LIVE if the game is still on, or says the final and stops.
//   · LIVE — say the latest play now, then every new one as the feed lands.
// `update(plays, over)` is the feed: call it whenever the game's plays change
// (and on a timer while the sheet is open); the reader speaks anything past
// its cursor, one at a time, never overlapping. `stop()` is immediate.
import type { GamePlay } from './gameFeed';
import { spokenPlay, spokenScore } from './spokenPlay';

export interface Voice {
  /** Speak one sentence; call `done` when it has finished (or failed). */
  speak(text: string, done: () => void): void;
  /** Cut the current sentence. */
  stop(): void;
}
export type ReaderMode = 'idle' | 'catchup' | 'live';
export interface ReaderState { mode: ReaderMode; cursor: number; speaking: boolean; finished: boolean }

export class PlayReader {
  private mode: ReaderMode = 'idle';
  private cursor = 0;          // index of the next play to say
  private speaking = false;
  private finished = false;    // said the final
  private plays: GamePlay[] = [];
  private over = false;
  private seq = 0;             // guards a late `done` from a stopped sentence
  constructor(private voice: Voice, private ctx: { home: string; away: string }, private onChange?: (s: ReaderState) => void) {}

  state(): ReaderState { return { mode: this.mode, cursor: this.cursor, speaking: this.speaking, finished: this.finished }; }
  private emit() { this.onChange?.(this.state()); }

  /** Start from the top (or resume from where a stop left the cursor). */
  catchUp(plays: GamePlay[], over: boolean, resume = true): void {
    this.voice.stop(); this.seq++; this.speaking = false; this.finished = false;
    this.plays = plays; this.over = over;
    if (!resume || this.cursor >= plays.length) this.cursor = 0;
    this.mode = 'catchup';
    this.emit();
    this.next();
  }

  /** Pick up at the present: the latest play now, then each new one. */
  live(plays: GamePlay[], over: boolean): void {
    this.voice.stop(); this.seq++; this.speaking = false; this.finished = false;
    this.plays = plays; this.over = over;
    this.cursor = Math.max(0, plays.length - 1);
    this.mode = 'live';
    this.emit();
    this.next();
  }

  /** The feed moved (or a timer ticked): say anything new. */
  update(plays: GamePlay[], over: boolean): void {
    this.plays = plays; this.over = over;
    if (this.mode !== 'idle' && !this.speaking) this.next();
  }

  stop(): void {
    this.voice.stop(); this.seq++;
    // The sentence that was cut is said again on resume: the cursor had
    // already stepped past it when it started.
    if (this.speaking && this.cursor > 0) this.cursor--;
    this.mode = 'idle'; this.speaking = false;
    this.emit();
  }

  private next(): void {
    if (this.mode === 'idle' || this.speaking) return;
    const p = this.plays[this.cursor];
    if (!p) {
      // Caught up. A live game waits for the feed; a finished one says so once.
      if (this.over && !this.finished && this.plays.length) {
        this.finished = true;
        const last = this.plays[this.plays.length - 1];
        this.say(`That's the final. ${spokenScore(last, this.ctx)}`, () => { this.mode = 'idle'; this.emit(); });
      } else if (this.mode === 'catchup') { this.mode = 'live'; this.emit(); }
      return;
    }
    const prev = this.cursor > 0 ? this.plays[this.cursor - 1] : null;
    const text = spokenPlay(p, { ...this.ctx, prev });
    this.cursor++;
    this.say(text, () => this.next());
  }

  private say(text: string, then: () => void): void {
    const my = ++this.seq;
    this.speaking = true; this.emit();
    this.voice.speak(text, () => {
      if (my !== this.seq) return; // stopped or restarted meanwhile
      this.speaking = false; this.emit();
      then();
    });
  }
}
