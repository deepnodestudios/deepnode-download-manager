import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';

const rootPkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf-8'));

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(rootPkg.version || '1.6.3')
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
        ws: true,
        // Backend originGuard yalnızca uygulamanın kendi origin'lerini kabul eder;
        // dev sunucusunun (localhost:3000) istekleri 403 olmasın diye Origin'i
        // backend'in beklediği değere çevir.
        configure: (proxy) => {
          const rewriteOrigin = (proxyReq) => {
            proxyReq.setHeader('Origin', 'http://localhost:5000');
          };
          proxy.on('proxyReq', rewriteOrigin);
          proxy.on('proxyReqWs', rewriteOrigin);
        }
      }
    }
  }
});
