// WHAT AN EMPTY HALF OF A SLOT MEANS (v0.334.0).
//
// Founder, on a locked TNF window before kickoff: "hmm game hasn't started yet
// and this is unopposed, but there's a whole full roster on my opponent's
// side."
//
// Nothing was wrong with the opponent's roster, and nothing was wrong with the
// data. One component draws BOTH of these, keyed on whether the player can sub
// in, and they were sharing the same words:
//
//   • AN UNOPPOSED STARTER — the opponent really did leave that spot empty.
//     "— NO OPPONENT —" is true, and it is worth saying loudly: an unopposed
//     player banks full value against nobody, and pays UNOPPOSED_COIN.
//
//   • A BACKUP — a bench player with no counterpart ANYWHERE, by construction.
//     The opponent does not field a backup opposite yours; there is no such
//     pairing in the game. It banks 0 unless it subs into one of YOUR starter
//     spots at final.
//
// Telling the second story with the first one's words makes a claim about the
// opponent's roster that is not merely unhelpful but FALSE — which is exactly
// what got read off the screen. A backup's empty half is not a statement about
// them at all.

export interface SlotEmptyCopy {
  /** Fills the vacant half of the row. */
  blank: string;
  /** The small chip under the row. */
  chip: string;
}

export function unopposedCopy(isBackup: boolean): SlotEmptyCopy {
  return isBackup
    // Says whose fault the emptiness ISN'T. "Not matched up" is the fact; the
    // sub-in rule is spelled out on its own line directly beneath.
    ? { blank: '— BACKUP · NOT MATCHED UP —', chip: 'BENCH' }
    : { blank: '— NO OPPONENT —', chip: 'UNOPP' };
}

/** Does this copy claim the opponent left a spot empty? The one thing a BACKUP
 *  row must never do. Exported so the assertion tests the RULE rather than the
 *  particular wording, which is free to change. */
export function claimsOpponentAbsent(c: SlotEmptyCopy): boolean {
  return /OPPONENT|UNOPP/i.test(`${c.blank} ${c.chip}`);
}
