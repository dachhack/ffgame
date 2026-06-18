import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Deployed to GitHub Pages at https://dachhack.github.io/ffgame/
// Base can be overridden for local/dev or a custom domain via VITE_BASE.
export default defineConfig({
  base: process.env.VITE_BASE ?? '/ffgame/',
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
