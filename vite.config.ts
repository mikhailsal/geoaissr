import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import path from 'node:path';

export default defineConfig({
  root: path.resolve(__dirname, 'web'),
  plugins: [svelte()],
  resolve: {
    alias: {
      $shared: path.resolve(__dirname, 'shared'),
    },
  },
  build: {
    outDir: path.resolve(__dirname, 'web/dist'),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/ws': {
        target: `ws://127.0.0.1:${process.env.GEOAISSR_BACKEND_PORT ?? '5174'}`,
        ws: true,
      },
      '/thumb': `http://127.0.0.1:${process.env.GEOAISSR_BACKEND_PORT ?? '5174'}`,
      '/healthz': `http://127.0.0.1:${process.env.GEOAISSR_BACKEND_PORT ?? '5174'}`,
      '/fake-pano': `http://127.0.0.1:${process.env.GEOAISSR_BACKEND_PORT ?? '5174'}`,
    },
  },
});
