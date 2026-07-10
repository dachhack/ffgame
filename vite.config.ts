import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { copyFileSync, existsSync } from 'node:fs';
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

// Deployed to GitHub Pages at https://dachhack.github.io/ffgame/
// Base can be overridden for local/dev or a custom domain via VITE_BASE.
export default defineConfig({
  base: process.env.VITE_BASE ?? '/ffgame/',
  plugins: [react(), spaFallback()],
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
