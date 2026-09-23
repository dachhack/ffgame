// WHICH SOURCE IS RIGHT ABOUT WHO IS HURT (v0.489.0).
//
// Founder: "I think Alec Pierce is out but he's listed as D in the platform."
//
// He was. ESPN's bulk injury report had Pierce Doubtful, stamped 01:03Z; Sleeper
// had him Out, stamped 18:00Z the same day. The platform polled ESPN and only
// ESPN, so it faithfully showed a designation seventeen hours behind the one the
// league's own app was showing its managers.
//
// That was not one player. Across the two feeds on the day: 23 of the 51 players
// BOTH sources designate disagreed, Sleeper more severe in all but three — and
// 174 that Sleeper designates, ESPN's report never mentions.
//
// It is not cosmetic either. `injury_status` is what 0333 discounts a projection
// by (O or IR to zero, D to a quarter), what the lock's auto-fill treats as
// ruled out, and what IR eligibility reads. Shown D instead of O, Pierce was
// being valued at a quarter of a player nobody could start.
//
// ── SO: TWO SOURCES, AND A RULE FOR WHEN THEY DISAGREE ──────────────────────
//
// SLEEPER IS THE LEAGUE'S OWN PLATFORM. The leagues, the rosters and the players
// are imported from it; its designation is the one the managers are already
// looking at in another tab. It gets the tie.
//
// BUT FRESHNESS WINS FIRST, because each source is stale in its own direction.
// ESPN's report is the official Wednesday-to-Sunday game status and lags
// mid-week news; Sleeper can hold an "Out" after a player is cleared. Both carry
// a timestamp — ESPN a per-designation date, Sleeper the player's last news
// update — so the newer statement wins and neither source's staleness is
// systematically believed.
//
// AND "ACTIVE" IS A STATEMENT. ESPN's feed lists 634 players as Active, with
// dates. That is a positive clearing signal, not an absence of one: on the day
// this was written it would have cleared 24 players Sleeper still had flagged.
// An Active newer than the other source's designation clears the player.
//
// What this module does NOT decide is what happens to a player neither source
// mentions any more — that is the poller's job, and until v0.489.0 the answer
// was "nothing, for ever" (see server/src/poll/injuries.js).

/** The four designations the platform stores. */
export type InjuryDesignation = 'O' | 'D' | 'Q' | 'IR';

/** Worse is higher. Only used to break a tie no timestamp can. */
export const INJURY_SEVERITY: Record<InjuryDesignation, number> = { Q: 1, D: 2, O: 3, IR: 4 };

/** One source's statement about one player. `status` null means the source is
 *  silent; 'A' means it says, positively, that he is active. */
export interface Statement {
  status: InjuryDesignation | 'A' | null;
  /** When the source made it: an ISO string, epoch ms, or nothing. */
  at?: string | number | null;
}

export interface MergedInjury { status: InjuryDesignation; source: 'espn' | 'sleeper' | 'espn+sleeper' }

/** Sleeper's `injury_status` → ours.
 *
 *  PUP counts as IR: a player on it mid-season is out at least four games, and
 *  IR is the designation the platform has for "gone beyond this Sunday".
 *  Suspensions, COVID, holdouts and "did not report" are deliberately NOT
 *  mapped — they are absences, not injuries, and dressing them as an injury
 *  designation would put them into a scoring discount built for one. */
export function mapSleeperStatus(raw?: string | null): InjuryDesignation | null {
  const s = (raw ?? '').trim().toLowerCase();
  if (!s) return null;
  if (s === 'out') return 'O';
  if (s === 'doubtful') return 'D';
  if (s === 'questionable') return 'Q';
  if (s === 'ir' || s === 'injured reserve' || s === 'pup') return 'IR';
  return null;
}

/** ESPN's type abbreviation → a statement's status. 'A' (Active) is kept, not
 *  dropped: it is the feed saying a man is available. */
export function mapEspnAbbr(raw?: string | null): InjuryDesignation | 'A' | null {
  const ab = (raw ?? '').trim().toUpperCase();
  return ab === 'O' || ab === 'D' || ab === 'Q' || ab === 'IR' || ab === 'A' ? ab : null;
}

/** Milliseconds, or null for anything unusable. */
function when(at?: string | number | null): number | null {
  if (at == null || at === '') return null;
  if (typeof at === 'number') return Number.isFinite(at) && at > 0 ? at : null;
  // ESPN dates come minute-precision and zoneless-but-Z ("2026-09-22T01:03Z").
  const t = Date.parse(/\dZ$/.test(at) && !/:\d\dZ$/.test(at) ? at.replace(/Z$/, ':00Z') : at);
  return Number.isFinite(t) ? t : null;
}

/** What the platform should store for one player, given what each source says.
 *
 *  Null means no designation — including when a source positively clears him. */
export function mergeInjury(espn?: Statement | null, sleeper?: Statement | null): MergedInjury | null {
  const e = espn?.status ?? null;
  const s = sleeper?.status ?? null;
  const te = when(espn?.at);
  const ts = when(sleeper?.at);
  const ed = e === 'A' ? null : e;     // ESPN's designation, if it has one
  const sd = s === 'A' ? null : s;     // Sleeper's

  // ── an Active clears the other side, unless the other side is newer ───────
  // With no clock on either statement the DESIGNATION stands: clearing a man on
  // no evidence of recency is how somebody starts a player who cannot play, and
  // a designation nobody repeats is pruned by the poller anyway.
  if (e === 'A' && sd) {
    return te != null && (ts == null || te > ts) ? null : { status: sd, source: 'sleeper' };
  }
  if (s === 'A' && ed) {
    return ts != null && (te == null || ts > te) ? null : { status: ed, source: 'espn' };
  }

  if (!sd) return ed ? { status: ed, source: 'espn' } : null;    // silent, or Active
  if (!ed) return { status: sd, source: 'sleeper' };
  if (ed === sd) return { status: ed, source: 'espn+sleeper' };

  // ── they disagree ─────────────────────────────────────────────────────────
  // The newer statement wins; with no clock to compare, the league's own
  // platform does.
  if (te != null && ts != null && te !== ts) {
    return te > ts ? { status: ed, source: 'espn' } : { status: sd, source: 'sleeper' };
  }
  return { status: sd, source: 'sleeper' };
}
