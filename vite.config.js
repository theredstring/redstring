/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './', // Required for Electron to load assets correctly
  build: {
    sourcemap: true,
    rollupOptions: {
      output: {
        // Temporarily disable custom manualChunks to avoid TDZ from circular imports
      }
    }
  },
  server: {
    host: true, // listen on all interfaces for LAN testing
    port: Number(process.env.VITE_DEV_PORT) || 4001,
    headers: {
      'Content-Security-Policy': "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*; connect-src 'self' http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:* https://query.wikidata.org https://dbpedia.org https://*.wikipedia.org https://*.wikidata.org https://api.conceptnet.io https://*.redstring.io https://upload.wikimedia.org; img-src 'self' data: blob: http://localhost:* http://127.0.0.1:* https://*.wikipedia.org https://*.wikidata.org https://upload.wikimedia.org;"
    },
    proxy: {
      // Primary API/bridge proxy to the semantic server
      '/api': {
        target: process.env.VITE_API_TARGET || 'http://localhost:3001',
        changeOrigin: true,
      },
      '/api/conceptnet': {
        target: 'http://api.conceptnet.io',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/conceptnet/, ''),
        configure: (proxy, options) => {
          proxy.on('error', (err, req, res) => {
            console.log('proxy error', err);
          });
          proxy.on('proxyReq', (proxyReq, req, res) => {
            console.log('Sending Request to the Target:', req.method, req.url);
          });
          proxy.on('proxyRes', (proxyRes, req, res) => {
            console.log('Received Response from the Target:', proxyRes.statusCode, req.url);
          });
        },
      }
    }
  },
  worker: {
    format: 'es',
    plugins: () => []
  },
  test: {
    globals: true,
    environment: 'jsdom',
    // setupFiles: './src/setupTests.js', // Optional: if you need setup files
    // Include both test/ and src/ directories
    include: ['test/**/*.{test,spec}.{js,jsx}', 'src/**/*.{test,spec}.{js,jsx}'],
  },
});
