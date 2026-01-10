/**
 * wizard-server.js - Clean, focused server for The Wizard
 * 
 * This replaces the 5000+ line bridge-daemon-legacy.js with a minimal
 * server that only handles wizard functionality.
 * 
 * Run with: node wizard-server.js
 * Or via npm: npm run wizard
 */

import express from 'express';
import cors from 'cors';
import net from 'net';
import { runAgent } from './src/wizard/AgentLoop.js';
import { debugLogSync } from './src/utils/debugLogger.js';

const app = express();

// Check if a port is available
function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close();
      resolve(true);
    });
    server.listen(port);
  });
}

// Find the port to use
async function getPort() {
  // Wizard uses 3001 by default (same as legacy bridge for compatibility)
  const preferred = parseInt(process.env.WIZARD_PORT || process.env.BRIDGE_PORT || '3001', 10);
  if (await isPortAvailable(preferred)) {
    return preferred;
  }
  
  // If 3001 is in use (e.g., by Electron's embedded bridge), that's fine
  // The UI will connect to whatever is on 3001
  console.log(`[Wizard] Port ${preferred} already in use.`);
  console.log(`[Wizard] If running alongside Electron, stop the Electron app first`);
  console.log(`[Wizard] or set WIZARD_PORT=3002 to run on a different port.`);
  
  throw new Error(`Port ${preferred} in use. Set WIZARD_PORT env var to use a different port.`);
}

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
  });
  next();
});

// ─────────────────────────────────────────────────────────────
// Scheduler (processes queued tool actions)
// ─────────────────────────────────────────────────────────────

let scheduler = null;

async function ensureSchedulerStarted() {
  if (!scheduler) {
    try {
      // #region agent log
      debugLogSync('wizard-server.js:scheduler:IMPORT_START', 'Importing scheduler', {}, 'debug-session', 'E');
      // #endregion
      const mod = await import('./src/services/orchestrator/Scheduler.js');
      scheduler = mod.default;
      // #region agent log
      debugLogSync('wizard-server.js:scheduler:IMPORT_OK', 'Scheduler imported', { hasDefault: !!mod.default }, 'debug-session', 'E');
      // #endregion
    } catch (e) {
      // #region agent log
      debugLogSync('wizard-server.js:scheduler:IMPORT_FAIL', 'Scheduler import failed', { error: e.message }, 'debug-session', 'E');
      // #endregion
      console.warn('[Wizard] Failed to load scheduler:', e.message);
      return;
    }
  }
  
  if (scheduler && typeof scheduler.start === 'function') {
    const status = scheduler.status();
    if (!status.enabled) {
      scheduler.start({ planner: true, executor: true, auditor: true });
      console.log('[Wizard] Scheduler started');
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Health Check
// ─────────────────────────────────────────────────────────────

app.get('/api/bridge/health', (req, res) => {
  res.json({
    status: 'ok',
    source: 'wizard-server',
    timestamp: new Date().toISOString(),
    scheduler: scheduler?.status() || { enabled: false }
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', source: 'wizard-server' });
});

// ─────────────────────────────────────────────────────────────
// The Wizard Endpoint (SSE streaming)
// ─────────────────────────────────────────────────────────────

app.post('/api/wizard', async (req, res) => {
  try {
    const { message, graphState, conversationHistory, config } = req.body || {};
    
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const apiKey = req.headers.authorization?.replace(/^Bearer\s+/i, '') || '';
    const apiConfig = config?.apiConfig || {};
    
    if (!apiKey) {
      return res.status(401).json({ error: 'API key required in Authorization header' });
    }

    // Set up SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
    
    const llmConfig = {
      apiKey,
      provider: apiConfig.provider || 'openrouter',
      endpoint: apiConfig.endpoint,
      model: apiConfig.model,
      temperature: apiConfig.settings?.temperature,
      maxTokens: apiConfig.settings?.max_tokens,
      cid: config?.cid || `wizard-${Date.now()}`,
      conversationHistory: conversationHistory || []
    };

    console.log('[Wizard] Request:', {
      messagePreview: message.substring(0, 50),
      historyLength: conversationHistory?.length || 0,
      activeGraph: graphState?.activeGraphId,
      model: llmConfig.model
    });

    try {
      for await (const event of runAgent(message, graphState || {}, llmConfig, ensureSchedulerStarted)) {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    } catch (error) {
      console.error('[Wizard] Agent error:', error);
      res.write(`data: ${JSON.stringify({ type: 'error', message: error.message })}\n\n`);
    }
    
    res.end();
  } catch (error) {
    console.error('[Wizard] Request error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message });
    } else {
      res.write(`data: ${JSON.stringify({ type: 'error', message: error.message })}\n\n`);
      res.end();
    }
  }
});

// ─────────────────────────────────────────────────────────────
// Scheduler Status
// ─────────────────────────────────────────────────────────────

app.get('/api/scheduler/status', (req, res) => {
  res.json(scheduler?.status() || { enabled: false, message: 'Scheduler not initialized' });
});

app.post('/api/scheduler/start', async (req, res) => {
  await ensureSchedulerStarted();
  res.json(scheduler?.status() || { enabled: false });
});

// ─────────────────────────────────────────────────────────────
// UI Compatibility Endpoints (minimal stubs)
// ─────────────────────────────────────────────────────────────

// Store registration - UI calls this on startup
let registeredStore = null;
app.post('/api/bridge/register-store', (req, res) => {
  registeredStore = req.body || {};
  res.json({ ok: true, registered: true });
});

// State endpoint - UI polls this
app.get('/api/bridge/state', (req, res) => {
  res.json({ 
    graphs: [],
    pendingActions: [],
    source: 'wizard-server'
  });
});

app.post('/api/bridge/state', (req, res) => {
  // Accept state updates from UI
  res.json({ ok: true });
});

// SSE events stream - UI subscribes to this for real-time updates
const sseClients = new Set();

app.get('/events/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  
  // Send initial ping
  res.write(`data: ${JSON.stringify({ type: 'connected', source: 'wizard-server' })}\n\n`);
  
  sseClients.add(res);
  
  req.on('close', () => {
    sseClients.delete(res);
  });
});

// Broadcast to all SSE clients (used internally)
function broadcastEvent(event) {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(data);
    } catch (e) {
      sseClients.delete(client);
    }
  }
}

// Telemetry endpoint
app.get('/api/bridge/telemetry', (req, res) => {
  res.json({ chat: [], tools: [] });
});

// ─────────────────────────────────────────────────────────────
// Fallback for unhandled endpoints
// ─────────────────────────────────────────────────────────────

app.all('/api/*', (req, res) => {
  console.log(`[Wizard] Unhandled: ${req.method} ${req.path}`);
  res.status(404).json({
    error: 'Endpoint not available in wizard-server',
    path: req.path,
    available: ['/api/wizard', '/api/bridge/health', '/api/bridge/state', '/events/stream']
  });
});

// ─────────────────────────────────────────────────────────────
// Start Server
// ─────────────────────────────────────────────────────────────

// Start server function
export async function startWizardServer() {
  // #region agent log
  debugLogSync('wizard-server.js:startWizardServer:ENTRY', 'startWizardServer called', {}, 'debug-session', 'C');
  // #endregion
  try {
    // #region agent log
    debugLogSync('wizard-server.js:getPort:BEFORE', 'About to call getPort', {}, 'debug-session', 'D');
    // #endregion
    const PORT = await getPort();
    // #region agent log
    debugLogSync('wizard-server.js:getPort:AFTER', 'getPort returned', { port: PORT }, 'debug-session', 'D');
    // #endregion
    
    return new Promise((resolve, reject) => {
      const server = app.listen(PORT, () => {
        console.log(`
╔═══════════════════════════════════════════════════════════╗
║                    🧙 THE WIZARD 🧙                        ║
╠═══════════════════════════════════════════════════════════╣
║  Server running on http://localhost:${PORT}                  ║
║                                                           ║
║  Endpoints:                                               ║
║    POST /api/wizard         - Chat with The Wizard        ║
║    GET  /api/bridge/health  - Health check                ║
║    GET  /api/scheduler/status - Queue processor status    ║
╚═══════════════════════════════════════════════════════════╝
`);
        
        // Start scheduler on boot
        ensureSchedulerStarted().catch(e => {
          console.warn('[Wizard] Failed to start scheduler on boot:', e.message);
        });
        
        resolve({ server, port: PORT });
      });
      
      server.on('error', reject);
    });
  } catch (e) {
    console.error('[Wizard] Failed to start:', e.message);
    throw e;
  }
}

// Auto-start when run directly (not imported)
// Check if this is the main module by looking at argv
const isMainModule = process.argv[1]?.endsWith('wizard-server.js');

if (isMainModule) {
  startWizardServer().catch(e => {
    console.error('[Wizard] Startup failed:', e);
    process.exit(1);
  });
}

export default app;

