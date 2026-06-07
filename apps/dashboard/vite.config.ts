import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [tailwindcss(), react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/recharts')) return 'recharts';
          if (id.includes('node_modules/rrweb') || id.includes('node_modules/rrweb-player')) {
            return 'rrweb';
          }
          if (id.includes('node_modules/react-simple-maps') || id.includes('node_modules/d3-')) {
            return 'maps';
          }
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
