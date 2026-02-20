/**
 * AI Bridge Service
 * Core bridge functionality for AI agent integration
 * Provides HTTP endpoints for UI ↔ AI orchestrator communication
 * No MCP dependencies - pure HTTP/Express
 */

import fetch from 'node-fetch';
import queueManager from './queue/Queue.js';
import eventLog from './EventLog.js';
import committer from './Committer.js';
import { setBridgeStoreRef } from './bridgeStoreAccessor.js';
import { getGraphStatistics, getGraphSemanticStructure } from './graphQueries.js';
import apiKeyManager from './apiKeyManager.js';
import executionTracer from './ExecutionTracer.js';
import { getToolDefinitions, executeTool } from '../wizard/tools/index.js';

// Lazily import scheduler to avoid pulling UI store modules at startup
let scheduler = null;

// Bridge state
let bridgeStoreData = {
    graphs: [],
    nodePrototypes: [],
    activeGraphId: null,
    openGraphIds: [],
    summary: { totalGraphs: 0, totalPrototypes: 0, lastUpdate: Date.now() },
    graphLayouts: {},
    graphSummaries: {},
    graphEdges: [],
    source: 'ai-bridge-service'
};

let pendingActions = [];
const inflightActionIds = new Set();
const inflightMeta = new Map();
let telemetry = [];
let chatLog = [];
let actionSequence = 0;

/**
 * Append a chat message to the log
 */
export function appendChat(role, text, extra = {}) {
    try {
        const entry = { ts: Date.now(), role, text: String(text || ''), ...extra };
        chatLog.push(entry);
        if (chatLog.length > 1000) chatLog = chatLog.slice(-800);
        telemetry.push({ ts: entry.ts, type: 'chat', role, text: entry.text, ...extra });
        try { eventLog.append({ type: 'chat', role, text: entry.text, ...extra }); } catch { }
    } catch { }
}

/**
 * Get current bridge state
 */
export function getBridgeState() {
    return bridgeStoreData;
}

/**
 * Get chat log
 */
export function getChatLog() {
    return chatLog;
}

/**
 * Get telemetry
 */
export function getTelemetry() {
    return telemetry;
}

/**
 * Ensure orchestrator scheduler is running
 */
async function ensureSchedulerStarted(logger) {
    try {
        if (!scheduler) {
            logger.info('[AI Bridge] Importing scheduler module...');
            const mod = await import('./orchestrator/Scheduler.js');
            scheduler = mod.default;
            logger.info('[AI Bridge] Scheduler imported');
        }
        const status = scheduler.status();
        logger.debug('[AI Bridge] Scheduler status:', status);
        if (!status.enabled) {
            logger.info('[AI Bridge] Starting scheduler...');
            scheduler.start({
                cadenceMs: 250,
                planner: true,
                executor: true,
                auditor: true,
                maxPerTick: { planner: 1, executor: 1, auditor: 1 }
            });
            const newStatus = scheduler.status();
            logger.debug('[AI Bridge] Scheduler started:', newStatus);
        } else {
            logger.debug('[AI Bridge] Scheduler already running');
        }
    } catch (e) {
        logger.error('[AI Bridge] Failed to start scheduler:', e);
    }
}

/**
 * Initialize AI bridge service routes on an Express app
 * @param {Express.Application} app - Express app instance
 * @param {Object} options - Configuration options
 * @param {Object} options.logger - Logger instance with info/warn/error/debug methods
 */
export function initializeBridgeService(app, options = {}) {
    const logger = options.logger || console;

    logger.info('[AI Bridge] Initializing AI bridge service...');

    // Reload recent chat history from event log
    try {
        const since = Date.now() - 48 * 60 * 60 * 1000; // last 48 hours
        const past = eventLog.replaySince(since).filter(e => e && e.type === 'chat');
        if (past.length) {
            chatLog = past.map(e => ({ ts: e.ts, role: e.role, text: e.text, cid: e.cid, channel: e.channel })).slice(-1000);
            telemetry.push(...chatLog.map(e => ({ ts: e.ts, type: 'chat', role: e.role, text: e.text, cid: e.cid })));
            logger.info(`[AI Bridge] Restored ${chatLog.length} chat messages from event log`);
        }
    } catch (err) {
        logger.warn('[AI Bridge] Failed to restore chat history:', err.message);
    }

    // Start committer and scheduler
    try {
        committer.start();
        logger.info('[AI Bridge] Committer started');
    } catch (err) {
        logger.error('[AI Bridge] Failed to start committer:', err);
    }

    // Lazy-load scheduler
    ensureSchedulerStarted(logger).catch(err => {
        logger.error('[AI Bridge] Scheduler initialization error:', err);
    });

    // ============================================================================
    // Bridge Endpoints
    // ============================================================================

    app.get('/api/bridge/health', (_req, res) => {
        res.json({ ok: true, hasStore: !!bridgeStoreData });
    });

    // ─────────────────────────────────────────────────────────────
    // UI Tool Tester Endpoints
    // ─────────────────────────────────────────────────────────────

    app.get('/api/wizard/tools', (req, res) => {
        try {
            const tools = getToolDefinitions();
            res.json({ tools });
        } catch (error) {
            logger.error('[AI Bridge] Failed to get tools:', error);
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

            logger.info(`[AI Bridge] Executing tool manually: ${name}`);

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

            await ensureSchedulerStarted(logger);

            const result = await executeTool(name, args || {}, safeGraphState, cid, async () => await ensureSchedulerStarted(logger));

            res.json({ success: true, result });
        } catch (error) {
            logger.error(`[AI Bridge] Error executing tool ${req.body?.name}:`, error);
            res.status(500).json({ error: error.message });
        }
    });

    app.post('/api/bridge/state', async (req, res) => {
        try {
            bridgeStoreData = { ...req.body, source: 'redstring-ui' };

            // Normalize edge data structure
            if (bridgeStoreData.graphEdges && Array.isArray(bridgeStoreData.graphEdges)) {
                bridgeStoreData.edges = {};
                for (const edge of bridgeStoreData.graphEdges) {
                    if (edge && edge.id) {
                        bridgeStoreData.edges[edge.id] = edge;
                    }
                }
                logger.debug(`[AI Bridge] Normalized ${bridgeStoreData.graphEdges.length} edges`);
            }

            // Normalize graph instances structure
            if (Array.isArray(bridgeStoreData.graphs)) {
                bridgeStoreData.graphs.forEach(graph => {
                    if (graph && !graph.instances) {
                        graph.instances = {};
                    } else if (graph && graph.instances && typeof graph.instances === 'object') {
                        if (graph.instances instanceof Map) {
                            graph.instances = Object.fromEntries(graph.instances.entries());
                        }
                    }
                });
                logger.debug(`[AI Bridge] Normalized ${bridgeStoreData.graphs.length} graphs`);
            }

            // Make store accessible to orchestrator components
            setBridgeStoreRef(bridgeStoreData);

            // CRITICAL: Forward state to bridge-daemon so AI agent has current state
            try {
                const BRIDGE_INTERNAL_URL = process.env.BRIDGE_INTERNAL_URL || 'http://localhost:3001';
                await fetch(`${BRIDGE_INTERNAL_URL}/api/bridge/state`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(req.body)
                });
                logger.debug('[AI Bridge] State forwarded to bridge-daemon');
            } catch (forwardErr) {
                logger.warn('[AI Bridge] Failed to forward state to bridge-daemon:', forwardErr.message);
                // Don't fail the request if forwarding fails
            }

            // Emit telemetry snapshot
            try {
                const gCount = Array.isArray(bridgeStoreData.graphs) ? bridgeStoreData.graphs.length : 0;
                const aId = bridgeStoreData.activeGraphId;
                const aName = bridgeStoreData.activeGraphName || null;
                const file = bridgeStoreData.fileStatus || null;
                telemetry.push({ ts: Date.now(), type: 'bridge_state', graphs: gCount, activeGraphId: aId, activeGraphName: aName, fileStatus: file });
            } catch { }

            if (bridgeStoreData.summary) bridgeStoreData.summary.lastUpdate = Date.now();
            res.json({ success: true });
        } catch (err) {
            logger.error('[AI Bridge] State update error:', err);
            res.status(500).json({ error: String(err?.message || err) });
        }
    });

    app.post('/api/bridge/layout', (req, res) => {
        try {
            const { layouts, mode = 'merge' } = req.body || {};
            if (!layouts || typeof layouts !== 'object') {
                return res.status(400).json({ error: 'layouts object is required' });
            }

            if (!bridgeStoreData.graphLayouts || typeof bridgeStoreData.graphLayouts !== 'object') {
                bridgeStoreData.graphLayouts = {};
            }

            const graphIds = Object.keys(layouts);
            graphIds.forEach((graphId) => {
                const incoming = layouts[graphId];
                if (!graphId || !incoming || typeof incoming !== 'object') return;
                const existing = bridgeStoreData.graphLayouts[graphId] || {};
                const mergedNodes = mode === 'replace'
                    ? { ...(incoming.nodes || {}) }
                    : { ...(existing.nodes || {}), ...(incoming.nodes || {}) };
                const metadata = {
                    ...(existing.metadata || {}),
                    ...(incoming.metadata || {}),
                    updatedAt: Date.now()
                };
                bridgeStoreData.graphLayouts[graphId] = {
                    ...existing,
                    ...incoming,
                    nodes: mergedNodes,
                    metadata
                };
            });

            if (bridgeStoreData.summary) {
                bridgeStoreData.summary.lastUpdate = Date.now();
            }

            res.json({ success: true, graphs: graphIds.length });
        } catch (err) {
            logger.error('[AI Bridge] Layout update error:', err);
            res.status(500).json({ error: String(err?.message || err) });
        }
    });

    app.get('/api/bridge/state', (_req, res) => {
        res.json(bridgeStoreData);
    });

    app.post('/api/bridge/register-store', (req, res) => {
        try {
            const { actions } = req.body || {};
            const keys = actions ? Object.keys(actions) : [];
            logger.debug(`[AI Bridge] Store actions registered: ${keys.join(', ')}`);
            res.json({ success: true, registeredActions: keys });
        } catch (err) {
            logger.error('[AI Bridge] Register store error:', err);
            res.status(500).json({ error: String(err?.message || err) });
        }
    });

    app.get('/api/bridge/pending-actions', (_req, res) => {
        try {
            logger.debug(`[AI Bridge] Pending actions requested - queue: ${pendingActions.length}, inflight: ${inflightActionIds.size}`);
            const available = pendingActions.filter(a => !inflightActionIds.has(a.id));
            if (available.length > 0) {
                logger.info(`[AI Bridge] Returning ${available.length} pending action(s)`);
            }
            available.forEach(a => {
                inflightActionIds.add(a.id);
                inflightMeta.set(a.id, { ts: Date.now(), action: a.action, params: a.params });
                telemetry.push({ ts: Date.now(), type: 'tool_call', name: a.action, args: a.params, leased: true, id: a.id });
            });
            res.json({ pendingActions: available });
        } catch (err) {
            logger.error('[AI Bridge] Pending actions error:', err);
            res.status(500).json({ error: String(err?.message || err) });
        }
    });

    app.post('/api/bridge/action-completed', (req, res) => {
        try {
            const { actionId } = req.body || {};
            if (actionId) {
                pendingActions = pendingActions.filter(a => a.id !== actionId);
                inflightActionIds.delete(actionId);
                const meta = inflightMeta.get(actionId);
                if (meta) {
                    telemetry.push({ ts: Date.now(), type: 'tool_call', name: meta.action, args: meta.params, status: 'completed', id: actionId, seq: ++actionSequence });
                    inflightMeta.delete(actionId);
                }
                logger.debug(`[AI Bridge] Action completed: ${actionId}`);
            }
            res.json({ success: true });
        } catch (err) {
            logger.error('[AI Bridge] Action completed error:', err);
            res.status(500).json({ error: String(err?.message || err) });
        }
    });

    app.post('/api/bridge/action-feedback', (req, res) => {
        try {
            const { action, status, error, params } = req.body || {};
            telemetry.push({ ts: Date.now(), type: 'action_feedback', action, status, error, params, seq: ++actionSequence });
            logger.debug(`[AI Bridge] Action feedback: ${action} - ${status}`);
            res.json({ acknowledged: true });
        } catch (err) {
            logger.error('[AI Bridge] Action feedback error:', err);
            res.status(500).json({ error: String(err?.message || err) });
        }
    });

    app.post('/api/bridge/action-started', (req, res) => {
        try {
            const { actionId, action, params } = req.body || {};
            if (actionId) {
                telemetry.push({ ts: Date.now(), type: 'tool_call', name: action || 'action', args: params, status: 'started', id: actionId });
                logger.debug(`[AI Bridge] Action started: ${actionId}`);
            }
            res.json({ ok: true });
        } catch (err) {
            logger.error('[AI Bridge] Action started error:', err);
            res.status(500).json({ error: String(err?.message || err) });
        }
    });

    // Tool status updates from Committer
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

            logger.debug(`[AI Bridge] Tool status: ${toolCalls.length} tool(s) completed for cid=${cid}`);
            res.json({ ok: true, updated: toolCalls.length });
        } catch (err) {
            logger.error('[AI Bridge] Tool status error:', err);
            res.status(500).json({ error: String(err?.message || err) });
        }
    });

    app.post('/api/bridge/chat/append', (req, res) => {
        try {
            const { role, text, cid, channel } = req.body || {};
            if (!text) return res.status(400).json({ error: 'text required' });
            appendChat(role || 'system', text, { cid, channel: channel || 'agent' });
            res.json({ ok: true });
        } catch (err) {
            logger.error('[AI Bridge] Chat append error:', err);
            res.status(500).json({ error: String(err?.message || err) });
        }
    });

    app.get('/api/bridge/telemetry', (_req, res) => {
        res.json({ telemetry, chat: chatLog.slice(-200) });
    });

    // Debug endpoints for execution tracing
    app.get('/api/bridge/debug/trace/:cid', (req, res) => {
        try {
            const { cid } = req.params;
            const trace = executionTracer.getTrace(cid);

            if (!trace) {
                return res.status(404).json({
                    error: 'Trace not found',
                    message: `No trace found for conversation ID: ${cid}`
                });
            }

            res.json(trace);
        } catch (err) {
            logger.error('[AI Bridge] Trace fetch error:', err);
            res.status(500).json({ error: String(err?.message || err) });
        }
    });

    app.get('/api/bridge/debug/traces', (req, res) => {
        try {
            const limit = parseInt(req.query.limit) || 20;
            const traces = executionTracer.getRecentTraces(limit);
            const summaries = traces.map(t => executionTracer.getTraceSummary(t.cid));

            res.json({
                traces: summaries,
                total: executionTracer.getAllTraces().length
            });
        } catch (err) {
            logger.error('[AI Bridge] Traces fetch error:', err);
            res.status(500).json({ error: String(err?.message || err) });
        }
    });

    app.get('/api/bridge/debug/trace/:cid/stage/:stageName', (req, res) => {
        try {
            const { cid, stageName } = req.params;
            const trace = executionTracer.getTrace(cid);

            if (!trace) {
                return res.status(404).json({
                    error: 'Trace not found',
                    message: `No trace found for conversation ID: ${cid}`
                });
            }

            const stage = trace.stages.find(s => s.stage === stageName);

            if (!stage) {
                return res.status(404).json({
                    error: 'Stage not found',
                    message: `No stage "${stageName}" found in trace for ${cid}`,
                    availableStages: trace.stages.map(s => s.stage)
                });
            }

            res.json(stage);
        } catch (err) {
            logger.error('[AI Bridge] Stage fetch error:', err);
            res.status(500).json({ error: String(err?.message || err) });
        }
    });

    app.get('/api/bridge/debug/stats', (req, res) => {
        try {
            const stats = executionTracer.getStats();
            res.json(stats);
        } catch (err) {
            logger.error('[AI Bridge] Stats fetch error:', err);
            res.status(500).json({ error: String(err?.message || err) });
        }
    });

    logger.info('[AI Bridge] AI bridge service initialized successfully');
    logger.info('[AI Bridge] Note: AI agent endpoints (/api/ai/agent) are handled by bridge-daemon on port 3001');
}

export default {
    initializeBridgeService,
    getBridgeState,
    getChatLog,
    getTelemetry,
    appendChat
};
