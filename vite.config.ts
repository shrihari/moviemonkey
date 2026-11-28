import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { TV_CHROME, tvLegacyCss } from './scripts/tv-legacy-css';

// https://v2.tauri.app/start/frontend/vite/
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  // tvLegacyCss: the TV stylesheet, rewritten for the older browsers in TVs.
  plugins: [react(), tailwindcss(), tvLegacyCss()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  build: {
    // The same build makes the TV screens, which run in TV browsers as old as
    // Chrome 79, so the script is written for that too.
    target: [process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome110' : 'safari16', `chrome${TV_CHROME}`],
    minify: !process.env.TAURI_ENV_DEBUG,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    rollupOptions: {
      // The app, and the TV screens Movie Monkey serves to TVs on the network.
      // The sample-films demo for getmoviemonkey.com is the TV screens alone.
      input: process.env.VITE_TV_DEMO === '1' ? { tv: 'tv.html' } : { main: 'index.html', tv: 'tv.html' },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
  },
});
