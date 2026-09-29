/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { readAgentToken } from './src/headless/agentToken.js';

const packageJson = JSON.parse(readFileSync('./package.json', 'utf-8'));
const projectRoot = path.dirname(fileURLToPath(import.meta.url));

// ── Dev server exposure (S-58) ────────────────────────────────────────────────
// The dev server serves the project root, which holds local secrets and user
// data. It listens on localhost only unless VITE_HOST (or `vite --host`) opts
// in to the LAN, and never serves the files below even then.
const DEV_HOST = process.env.VITE_HOST || 'localhost';
const rootPath = (p) => path.join(projectRoot, p).split(path.sep).join('/');
export const DEV_FS_DENY = [
  // vite's defaults
  '.env', '.env.*', '*.{crt,pem}',
  // local secrets
  'WIZARD_KEY.txt', 'github.env', 'github.env.*', '.env*', '*.pem', '*.key', '.dev.vars', '*private-key*',
  // user data and runtime journals (anchored to this project, so a dependency's
  // own data/ folder is unaffected)
  `${rootPath('data')}/**`,
  `${rootPath('universes')}/**`,
  `${rootPath('events')}/**`,
  'backup.redstring',
];

// ── Agent server proxy (C-6, web dev) ─────────────────────────────────────────
// In `npm run dev` the page talks to the local agent server through this
// same-origin prefix (see src/services/bridgeConfig.js). The proxy adds the
// agent's token server-side, read from ~/.redstring/agent.json (or
// REDSTRING_AGENT_TOKEN), so it never reaches the page — and only for
// requests from this machine.
export const DEV_AGENT_PROXY_PREFIX = '/__redstring_agent';
const AGENT_PORT = Number(process.env.REDSTRING_AGENT_PORT || process.env.WIZARD_PORT || 3001);

export function isLoopbackAddress(addr) {
  const a = String(addr || '');
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1' || a.startsWith('127.');
}

function isLoopbackOrigin(origin) {
  try {
    const { protocol, hostname } = new URL(origin);
    return protocol === 'http:' && (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]');
  } catch {
    return false;
  }
}

export const agentProxy = {
  target: `http://127.0.0.1:${AGENT_PORT}`,
  changeOrigin: true, // Host becomes 127.0.0.1:PORT, which the agent's guard requires
  rewrite: (p) => p.slice(DEV_AGENT_PROXY_PREFIX.length) || '/',
  // Never lend the token to another machine (VITE_HOST / --host): 404 instead.
  bypass: (req) => (isLoopbackAddress(req.socket?.remoteAddress) ? undefined : false),
  configure: (proxy) => {
    proxy.on('proxyReq', (proxyReq, req) => {
      // The page's own origin (any vite port) is this proxy's business, not
      // the agent's; any other Origin is passed through for the agent to reject.
      const origin = req.headers.origin;
      if (origin && isLoopbackOrigin(origin)) proxyReq.removeHeader('origin');
      const token = readAgentToken({ port: AGENT_PORT });
      if (token) proxyReq.setHeader('X-Redstring-Token', token);
    });
  },
};

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(packageJson.version)
  },
  plugins: [react()],
  // `npm run build:profile` (mode "profile") swaps in React's profiling build so
  // <Profiler onRender> fires in an optimised bundle (P0.01, renderProbe.js).
  // React 18 dropped scheduler/tracing, so react-dom is the only alias needed.
  resolve: {
    alias: [
      ...(mode === 'profile' ? [{ find: /^react-dom$/, replacement: 'react-dom/profiling' }] : []),
      // Store builds leave out heic-to (LGPL-3.0 libheif); see src/utils/heicUnsupportedStub.js
      ...(mode === 'capacitor' ? [{ find: /^heic-to$/, replacement: path.join(projectRoot, 'src/utils/heicUnsupportedStub.js') }] : []),
    ],
  },
  base: './', // Required for Electron to load assets correctly
  build: {
    outDir: mode === 'profile' ? 'dist-profile' : 'dist',
    // Sourcemaps double the shipped asset size; skip them in the iOS app bundle
    sourcemap: mode !== 'capacitor',
    rollupOptions: {
      output: {
        // Temporarily disable custom manualChunks to avoid TDZ from circular imports
      }
    }
  },
  server: {
    host: DEV_HOST, // localhost only; VITE_HOST=0.0.0.0 (or --host) for LAN testing
    port: Number(process.env.VITE_DEV_PORT) || 4001,
    fs: {
      deny: DEV_FS_DENY,
    },
    headers: {
      'Content-Security-Policy': "default-src 'self' 'unsafe-inline' data: blob: http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*; connect-src 'self' http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:* https: wss:; img-src 'self' data: blob: http://localhost:* http://127.0.0.1:* https://*.wikipedia.org https://*.wikidata.org https://*.wikimedia.org;"
    },
    proxy: {
      [DEV_AGENT_PROXY_PREFIX]: agentProxy,
      // Primary API/bridge proxy to the semantic server
      '/api': {
        target: process.env.VITE_API_TARGET || 'http://localhost:3001',
        changeOrigin: true,
        // Don't relay requests from other machines that carry no Origin
        // (non-browser clients on the LAN when VITE_HOST is set).
        bypass: (req) => (isLoopbackAddress(req.socket?.remoteAddress) || req.headers.origin ? undefined : false),
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
}));
