// THE WIDGETS BUILD (v0.505.0) — every state of the matchup, alerts and fields
// widgets, through react-native-android-widget's own tree builder.
//
// A widget that the builder cannot turn into a tree is not an error anyone
// sees: the home screen shows a blank tile, on a phone, on a Sunday. Two
// shapes do it and TypeScript accepts both — a React fragment (the builder
// calls every element's type as a function; a fragment's type is a symbol)
// and a component that returns null. So the pictures are built here, in Node,
// with the library's widgets and builder (scripts/widget-render/shim.cjs) and
// a stub for the one React Native call its ImageWidget makes.
// Run: node scripts/check-widget-render.mjs
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(mkdtempSync(join(tmpdir(), 'widget-render-')), 'states.cjs');
await build({
  entryPoints: [join(here, 'widget-render/states.tsx')],
  bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', logLevel: 'error',
  tsconfig: join(here, '../apps/mobile/tsconfig.json'),
  alias: { 'react-native-android-widget': join(here, 'widget-render/shim.cjs'), 'react-native': join(here, 'widget-render/rn-stub.cjs') },
  outfile: out,
});
try {
  process.stdout.write(execFileSync(process.execPath, [out], { encoding: 'utf8' }));
} catch (e) {
  process.stdout.write(e.stdout ?? '');
  console.log('\nWIDGET RENDER CHECK FAILED');
  process.exit(1);
}
