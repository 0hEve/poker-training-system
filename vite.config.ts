import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/** Starts the local bot gateway (external bots) alongside the dev server. Skip with NO_BOT_GATEWAY=1. */
function botGateway(): Plugin {
  return {
    name: 'bot-gateway',
    apply: 'serve',
    async configureServer(server) {
      if (process.env.NO_BOT_GATEWAY) return;
      const { ensureGateway } = await import('./scripts/bot-gateway.mjs');
      const gw = await ensureGateway({ quiet: true });
      server.httpServer?.once('close', () => gw.stop());
    },
  };
}

// base './' so the built index.html works from file:// inside Electron.
export default defineConfig({
  base: './',
  plugins: [react(), botGateway()],
  build: { outDir: 'dist', emptyOutDir: true },
});
