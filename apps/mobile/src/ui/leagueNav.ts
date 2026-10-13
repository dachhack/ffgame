// THE LEAGUE'S ROOMS, FROM ANYWHERE (v0.706.0, founder: "Clicking the chip
// takes you to the vows interaction"). The app owns which room is on screen;
// a chip deep in a board can't reach that state through props without
// threading it through every screen between. The same module-level bus as the
// player card: the app installs the go-to-room hand once, and a surface asks.
// A request for a Team tab, or for the vows composer, waits here until the
// screen that owns it mounts and takes it.
export type LeagueRoomName = 'picks' | 'draft' | 'team' | 'chat' | 'commishtools';
type TeamTab = 'roster' | 'waivers' | 'trades' | 'keepers' | 'contracts' | 'devy';

let go: ((room: LeagueRoomName) => void) | null = null;
let teamTab: TeamTab | null = null;
let vows = false;

/** Installed by the app shell; returns the uninstall. */
export const onLeagueGo = (fn: (room: LeagueRoomName) => void): (() => void) => { go = fn; return () => { if (go === fn) go = null; }; };
export const goLeagueRoom = (room: LeagueRoomName): void => { go?.(room); };
/** The Team screen opens on this tab the next time it mounts. */
export const requestTeamTab = (tab: TeamTab): void => { teamTab = tab; };
export const takeTeamTab = (): TeamTab | null => { const t = teamTab; teamTab = null; return t; };
/** The wedding card opens its vows composer the next time it loads your pending wedding. */
export const requestVows = (): void => { vows = true; };
export const takeVows = (): boolean => { const v = vows; vows = false; return v; };
