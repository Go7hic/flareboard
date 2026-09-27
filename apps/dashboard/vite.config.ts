import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const siteUrl = (process.env.VITE_SITE_URL ?? 'https://flareboard.dev').replace(/\/$/, '');

export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
    {
      name: 'html-site-url',
      transformIndexHtml(html) {
        return html.replaceAll('%VITE_SITE_URL%', siteUrl);
      },
    },
  ],
  build: {
    rollupOptions: {
      output: {
        // Only name chunks the entry needs anyway. A manual chunk also absorbs its
        // shared deps (clsx, react-is, ...), so naming recharts/maps here made the
        // landing page preload them; lazy routes get them via automatic splitting.
        manualChunks(id) {
          if (id.includes('node_modules/@tanstack/react-query')) return 'query';
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8788',
        changeOrigin: true,
      },
    },
  },
});
