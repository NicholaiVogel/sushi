// @ts-check
import { defineConfig } from 'astro/config';

import react from '@astrojs/react';

/** @type {import('astro').AstroIntegration} */
const webmcpOriginIsolation = {
  name: 'sushi-webmcp-origin-isolation',
  hooks: {
    'astro:server:setup': ({ server }) => {
      server.middlewares.use((_request, response, next) => {
        // WebMCP is only exposed to origin-keyed agent clusters. The
        // explicit response header keeps Astro dev/preview compatible with
        // that requirement.
        response.setHeader('Origin-Agent-Cluster', '?1');
        response.setHeader('Permissions-Policy', 'tools=(self), midi=(self)');
        next();
      });
    },
  },
};

// https://astro.build/config
export default defineConfig({
  integrations: [react(), webmcpOriginIsolation],
  vite: {
    // Soundfont loading is intentionally lazy in the adapter, but keeping the
    // package in the dependency graph prevents Vite from emitting an outdated
    // optimized-dependency URL on the first GM-instrument playback.
    optimizeDeps: {
      include: ['@strudel/soundfonts'],
    },
    preview: {
      headers: {
        'Origin-Agent-Cluster': '?1',
        'Permissions-Policy': 'tools=(self), midi=(self)',
      },
    },
  },
});
