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
import { getToolDefinitions, executeTool } from './src/wizard/tools/index.js';
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
      conversationHistory: conversationHistory || [],
      systemPrompt: config?.systemPrompt,
      maxIterations: config?.persona === 'druid' ? 25 : 10
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
// UI Tool Tester Endpoints
// ─────────────────────────────────────────────────────────────

app.get('/api/wizard/tools', (req, res) => {
  try {
    const tools = getToolDefinitions();
    res.json({ tools });
  } catch (error) {
    console.error('[Wizard] Failed to get tools:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/wizard/execute-tool', async (req, res) => {
  try {
    const { name, args, graphState, config } = req.body || {};

    if (!name) {
      return res.status(400).json({ error: 'Tool name is required' });
    }

    const cid = config?.cid || `tool-test-${Date.now()}`;
    const apiKey = req.headers.authorization?.replace(/^Bearer\s+/i, '') || '';

    console.log(`[Wizard] Executing tool manually: ${name}`, args);

    // Create a synthesized graphState if not fully valid
    const safeGraphState = graphState || {
      graphs: [],
      nodePrototypes: [],
      edges: [],
      activeGraphId: null
    };

    // Inject the apiKey if it's not present just in case a tool needs it
    if (apiKey && !safeGraphState.apiKey) {
      safeGraphState.apiKey = apiKey;
    }

    await ensureSchedulerStarted();

    const result = await executeTool(name, args || {}, safeGraphState, cid, ensureSchedulerStarted);

    res.json({ success: true, result });
  } catch (error) {
    console.error(`[Wizard] Error executing tool ${req.body?.name}:`, error);
    res.status(500).json({ error: error.message });
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
    source: 'wizard-server',
    summary: { lastUpdate: Date.now() } // added so mcpClient.js connects
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

// ─────────────────────────────────────────────────────────────
// Pending Actions State (for UI ↔ Server communication)
// ─────────────────────────────────────────────────────────────

let pendingActions = [];
const inflightActionIds = new Set();
const inflightMeta = new Map(); // id -> { ts, action, params }
let telemetry = [];
let chatLog = [];

// Telemetry endpoint
app.get('/api/bridge/telemetry', (req, res) => {
  res.json({ telemetry, chat: chatLog.slice(-200) });
});

// ─────────────────────────────────────────────────────────────
// Pending Actions Endpoints (for Committer and UI)
// ─────────────────────────────────────────────────────────────

// GET pending actions - UI polls this to receive mutations
app.get('/api/bridge/pending-actions', (req, res) => {
  try {
    const available = pendingActions.filter(a => !inflightActionIds.has(a.id));
    available.forEach(a => {
      inflightActionIds.add(a.id);
      inflightMeta.set(a.id, { ts: Date.now(), action: a.action, params: a.params });
      telemetry.push({ ts: Date.now(), type: 'tool_call', name: a.action, args: a.params, leased: true, id: a.id });
    });
    res.json({ pendingActions: available });
  } catch (err) {
    console.error('[Wizard] Pending actions error:', err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

// POST enqueue actions - Committer uses this to push mutations
app.post('/api/bridge/pending-actions/enqueue', (req, res) => {
  try {
    const { actions } = req.body || {};
    if (!Array.isArray(actions) || actions.length === 0) {
      return res.status(400).json({ ok: false, error: 'actions[] required' });
    }
    // Prepend openGraph actions inferred from any applyMutations ops to avoid UI timing races
    const expanded = [];
    for (const a of actions) {
      if (a && a.action === 'applyMutations' && Array.isArray(a.params?.[0])) {
        const ops = a.params[0];
        const graphIds = new Set();
        for (const op of ops) {
          if (op && typeof op.graphId === 'string' && op.graphId) graphIds.add(op.graphId);
        }
        for (const gid of graphIds) expanded.push({ action: 'openGraph', params: [gid] });
      }
      expanded.push(a);
    }
    const id = (suffix) => `pa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${suffix}`;
    for (const a of expanded) {
      pendingActions.push({ id: id(a.action || 'act'), action: a.action, params: a.params, timestamp: Date.now() });
      telemetry.push({ ts: Date.now(), type: 'tool_call', name: a.action, args: a.params, status: 'queued' });
    }
    res.json({ ok: true, enqueued: actions.length });
  } catch (err) {
    console.error('[Wizard] Enqueue error:', err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

// POST action completed - UI calls this when an action is done
app.post('/api/bridge/action-completed', (req, res) => {
  try {
    const { actionId } = req.body || {};
    if (actionId) {
      pendingActions = pendingActions.filter(a => a.id !== actionId);
      inflightActionIds.delete(actionId);
      const meta = inflightMeta.get(actionId);
      if (meta) {
        telemetry.push({ ts: Date.now(), type: 'tool_call', name: meta.action, args: meta.params, status: 'completed', id: actionId });
        inflightMeta.delete(actionId);
      }
    }
    res.json({ success: true });
  } catch (err) {
    console.error('[Wizard] Action completed error:', err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

// POST action feedback - for warnings and errors
app.post('/api/bridge/action-feedback', (req, res) => {
  try {
    const { action, status, error, params } = req.body || {};
    telemetry.push({ ts: Date.now(), type: 'action_feedback', action, status, error, params });
    console.log(`[Wizard] Action feedback: ${action} - ${status}`);
    res.json({ acknowledged: true });
  } catch (err) {
    console.error('[Wizard] Action feedback error:', err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

// POST tool status - track tool execution
app.post('/api/bridge/tool-status', (req, res) => {
  try {
    const { cid, toolCalls } = req.body || {};
    if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
      return res.status(400).json({ error: 'toolCalls array required' });
    }
    for (const tool of toolCalls) {
      telemetry.push({
        ts: tool.timestamp || Date.now(),
        type: 'tool_call',
        name: tool.name,
        args: tool.args || {},
        status: tool.status || 'completed',
        result: tool.result,
        error: tool.error,
        executionTime: tool.executionTime,
        cid
      });
    }
    res.json({ ok: true, updated: toolCalls.length });
  } catch (err) {
    console.error('[Wizard] Tool status error:', err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

// POST chat append - add messages to chat log
app.post('/api/bridge/chat/append', (req, res) => {
  try {
    const { role, text, cid, channel } = req.body || {};
    if (!text) return res.status(400).json({ error: 'text required' });
    const entry = { ts: Date.now(), role: role || 'system', text: String(text), cid, channel: channel || 'agent' };
    chatLog.push(entry);
    if (chatLog.length > 1000) chatLog = chatLog.slice(-800);
    telemetry.push({ ts: entry.ts, type: 'chat', role: entry.role, text: entry.text, cid, channel });
    res.json({ ok: true });
  } catch (err) {
    console.error('[Wizard] Chat append error:', err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

// ─────────────────────────────────────────────────────────────
// Fallback for unhandled endpoints
// ─────────────────────────────────────────────────────────────

app.all('/api/*', (req, res) => {
  console.log(`[Wizard] Unhandled: ${req.method} ${req.path}`);
  res.status(404).json({
    error: 'Endpoint not available in wizard-server',
    path: req.path,
    available: ['/api/wizard', '/api/bridge/health', '/api/bridge/state', '/api/bridge/pending-actions', '/events/stream']
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

