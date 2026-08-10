import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

// GitHub Pages serves `404.html` for any unknown path. Copying the built
// index.html to 404.html makes shared/typo'd deep links load the SPA (which then
// resolves the route client-side) instead of hitting the default GH Pages 404.
function spaFallback(): Plugin {
  return {
    name: 'spa-404-fallback',
    apply: 'build',
    closeBundle() {
      const index = resolve(__dirname, 'dist/index.html');
      if (existsSync(index)) copyFileSync(index, resolve(__dirname, 'dist/404.html'));
    },
  };
}

// `public/sw.js` ships with two placeholders it can't fill in itself: the list of
// content-hashed build files to precache, and a cache-busting version. Fill them
// after the bundle is written. Doing it here (rather than pulling in Workbox /
// vite-plugin-pwa) keeps the four-dependency tree intact and keeps the caching
// rules readable in one file — see the header comment in public/sw.js.
function pwaServiceWorker(): Plugin {
  let assets: string[] = [];
  return {
    name: 'pwa-service-worker',
    apply: 'build',
    writeBundle(_options, bundle) {
      // JS and CSS only. Images/fonts emitted by the bundler are runtime-cached
      // instead; precaching them would slow the install for art most sessions
      // never request.
      assets = Object.keys(bundle).filter((f) => /\.(js|css)$/.test(f)).sort();
    },
    closeBundle() {
      const sw = resolve(__dirname, 'dist/sw.js');
      if (!existsSync(sw)) return;
      // The app version is the human-readable half; the digest is the honest half
      // — it changes whenever the build does, so a forgotten APP_VERSION bump
      // can't leave two different builds sharing one cache name.
      const version = /APP_VERSION\s*=\s*'([^']+)'/.exec(
        readFileSync(resolve(__dirname, 'src/app/version.ts'), 'utf8'),
      )?.[1] ?? 'dev';
      const digest = createHash('sha256').update(assets.join('\n')).digest('hex').slice(0, 8);
      writeFileSync(sw, readFileSync(sw, 'utf8')
        .replace('"__PRECACHE__"', assets.map((a) => JSON.stringify(a)).join(', '))
        .replace('__VERSION__', `${version}-${digest}`));
    },
  };
}

// Deployed to GitHub Pages at https://dachhack.github.io/ffgame/
// Base can be overridden for local/dev or a custom domain via VITE_BASE.
export default defineConfig({
  base: process.env.VITE_BASE ?? '/ffgame/',
  plugins: [react(), spaFallback(), pwaServiceWorker()],
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        // Split rarely-changing vendor code into its own long-cached chunks so a
        // code change doesn't bust the whole ~250KB gzip payload, and the browser
        // can fetch them in parallel.
        manualChunks: {
          react: ['react', 'react-dom'],
          supabase: ['@supabase/supabase-js'],
        },
      },
    },
  },
});
