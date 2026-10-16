import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';

const rootPkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf-8'));

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(rootPkg.version || '1.5.9')
  },
  base: './', // Essential for Electron file:// protocol loading!
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-chart': ['chart.js', 'react-chartjs-2'],
          'vendor-icons': ['lucide-react'],
          'vendor-sentry': ['@sentry/react']
        }
      }
    }
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        ws: true
      }
    }
  }
});
