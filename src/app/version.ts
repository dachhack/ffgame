// Bump this on each notable change so we can tell which build is live.
// Versioning: 3-part semver, pre-1.0. Bump patch per deploy (0.10.1, 0.10.2…),
// minor for bigger features (0.11, 0.12…). Segments aren't capped at 9, so 1.0
// is a deliberate choice, not an automatic rollover.
export const APP_VERSION = 'v0.51.0';

// Stat data + 2025 NFL play-by-play powering this game comes from Stathead.
export const DATA_SOURCE = { name: 'Stathead', url: 'https://stathead.app' };
