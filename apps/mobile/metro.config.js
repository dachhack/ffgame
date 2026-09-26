// Metro in a monorepo. Two things differ from a standalone Expo app:
//
// 1. watchFolders must include the repo root, or Metro won't see @drip/core's
//    source and every import resolves to "module not found".
// 2. nodeModulesPaths must list BOTH the app's and the root's node_modules,
//    because npm workspaces hoists most packages to the root while keeping a
//    few (anything with a version conflict) local to the app.
//
// @drip/core is source-only TypeScript with no build step, exactly as on web —
// Metro compiles it as part of the app, so a change in the engine hot-reloads
// here the same way it does in Vite.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

// No lazy bundles in dev. With lazy on, Metro serves every dynamic import()
// as a separate bundle fetched at runtime, and core's
// `import('@supabase/supabase-js')` (supabaseClient.ts) came back in the iOS
// dev build as "Requiring unknown module" / "Cannot set property 'importedAll'
// of undefined" — sign-in dead. Release builds inline every import already;
// this makes dev match. Set here rather than only in the npm scripts so a
// bare `npx expo start` gets it too: the CLI reads it per manifest request,
// after this file has loaded.
process.env.EXPO_NO_METRO_LAZY = '1';

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
// Mirrors the tsconfig `paths` entry and the web app's Vite alias, so the same
// import specifier resolves identically in all three toolchains.
config.resolver.extraNodeModules = {
  '@drip/core': path.resolve(workspaceRoot, 'packages/core'),
};
// Workspace symlinks resolve to real paths outside projectRoot; without this
// Metro refuses to serve them.
config.resolver.disableHierarchicalLookup = false;

module.exports = config;
