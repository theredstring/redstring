/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Separate the store and services into different chunks to avoid circular dependencies
          store: ['./src/store/graphStore.jsx', './src/store/fileStorage.js'],
          services: ['./src/services/universeBackend.js', './src/services/orbitResolver.js']
        }
      }
    }
  },
  server: {
    host: true, // listen on all interfaces for LAN testing
    port: 4000,
    proxy: {
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
