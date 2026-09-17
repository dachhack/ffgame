// THE DRAFT LOG, in words (0284/0285). One line per event, shared by both
// hosts so the same thing reads the same way on the web and in the app.
import type { DraftEvent } from './liveApi';

export type DraftLineTone = 'you' | 'warn' | 'dim' | 'text';
export interface DraftLine { icon: string; text: string; tone: DraftLineTone }

function seat(e: DraftEvent): string {
  return e.team ?? (e.roster_id != null ? `Team ${e.roster_id}` : 'The room');
}
function player(e: DraftEvent): string {
  return e.player ? `${e.player}${e.pos ? ` (${e.pos}${e.nfl ? ` · ${e.nfl}` : ''})` : ''}` : (e.slug ?? 'a player');
}
/** Who did it — the worker's clock, the commissioner, or a seat. */
function actor(e: DraftEvent): string {
  if (e.actor_role === 'server') return 'The clock';
  if (e.actor_role === 'commish') return 'The commissioner';
  return e.actor_team ?? (e.actor_roster != null ? `Team ${e.actor_roster}` : 'Someone');
}
function pickNo(e: DraftEvent): string {
  if (e.overall == null) return '';
  return e.round != null ? ` — pick ${e.overall}, R${e.round}` : ` — pick ${e.overall}`;
}

export function draftEventLine(e: DraftEvent): DraftLine {
  switch (e.kind) {
    case 'start': {
      const mode = typeof e.detail?.mode === 'string' ? ` · ${String(e.detail.mode)}` : '';
      return { icon: '▶', text: `The draft opened${mode}`, tone: 'you' };
    }
    case 'pick':      return { icon: '✓', text: `${seat(e)} took ${player(e)}${pickNo(e)}`, tone: 'text' };
    case 'autopick':  return { icon: '🤖', text: `${seat(e)} auto-picked ${player(e)}${pickNo(e)}`, tone: 'dim' };
    case 'forced':    return { icon: '⚑', text: `${actor(e)} picked ${player(e)} for ${seat(e)}${pickNo(e)}`, tone: 'warn' };
    case 'won':       return { icon: '🔨', text: `${seat(e)} won ${player(e)} for $${e.price ?? '?'}${pickNo(e)}`, tone: 'text' };
    case 'nominate':  return { icon: '📣', text: `${seat(e)} nominated ${player(e)} at $${e.price ?? 1}`, tone: 'dim' };
    case 'removed':   return { icon: '↩', text: `${actor(e)} removed ${player(e)} from ${seat(e)}${pickNo(e)}`, tone: 'warn' };
    case 'edit': {
      const from = typeof e.detail?.from === 'string' ? ` (was ${String(e.detail.from)})` : '';
      return { icon: '✎', text: `${actor(e)} changed ${seat(e)}'s pick${pickNo(e)} to ${player(e)}${from}`, tone: 'warn' };
    }
    case 'reset':     return { icon: '⟲', text: `${actor(e)} reset the draft — the board is clear`, tone: 'warn' };
    case 'pause':     return { icon: '⏸', text: `${actor(e)} paused the draft${e.overall != null ? ` at pick ${e.overall}` : ''}`, tone: 'warn' };
    case 'resume':    return { icon: '▶', text: `${actor(e)} resumed the draft`, tone: 'you' };
    case 'complete':  return { icon: '🏁', text: `Draft complete${e.overall != null ? ` — ${e.overall} picks` : ''}`, tone: 'you' };
    case 'autodraft_on':  return { icon: '🤖', text: `${seat(e)} turned autodraft ON`, tone: 'dim' };
    case 'autodraft_off': return { icon: '🙋', text: `${seat(e)} turned autodraft OFF — picking by hand again`, tone: 'dim' };
    case 'timeout':   return { icon: '⏱', text: `${seat(e)} ran out of time${pickNo(e)} — autodraft is on until they turn it off`, tone: 'warn' };
    default:          return { icon: '·', text: String(e.kind), tone: 'dim' };
  }
}

/** "8:14 PM" — the log is read during and right after a draft, so the time
 *  of day is the useful unit; the date would just be today. */
export function draftEventTime(at: string): string {
  const t = Date.parse(at);
  if (!Number.isFinite(t)) return '';
  return new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
