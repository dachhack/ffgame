// ESPN seasontype codes, named once. The scheduler runs one CONTEXT per type
// that currently has games (index.js activeContexts), so anything tied to a
// specific kind of week — Sleeper's schedule, pods, showdowns — should say which
// it means rather than reading a process-wide setting.
export const PRESEASON = 1;
export const REGULAR_SEASON = 2;
export const POSTSEASON = 3;
