/**
 * Redstring MCP Server
 * Provides MCP tools for Claude Desktop to interact with Redstring's knowledge graph
 * This server connects to the REAL Redstring store, not a simulation
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import express from 'express';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import fs from 'fs';
import http from 'http';
import https from 'https';
import { getToolDefinitions, executeTool } from './src/wizard/tools/index.js';
import { createLocalServerGuard, allowedOriginsFromEnv } from './src/security/localServerGuard.js';
import { agentAuthHeaders, generateAgentToken, recordMcpHttpToken, forgetMcpHttpToken } from './src/headless/agentToken.js';

// Load environment variables (debug off to avoid noisy logs)
dotenv.config({ quiet: true });

/**
 * Simple promise-based queue to serialize tool execution
 */
class ToolQueue {
  constructor() {
    this.queue = Promise.resolve();
    this.lastToolCall = null;
    this.callCount = 0;
  }

  async enqueue(name, task) {
    const sequence = ++this.callCount;
    const prev = this.queue;

    this.queue = (async () => {
      await prev;
      console.error(`[Queue] #${sequence} Starting: ${name}`);
      const startTime = Date.now();
      try {
        const result = await task();
        console.error(`[Queue] #${sequence} Finished: ${name} (${Date.now() - startTime}ms)`);
        return result;
      } catch (err) {
        console.error(`[Queue] #${sequence} Failed: ${name} - ${err.message}`);
        throw err;
      }
    })();

    return this.queue;
  }
}

const toolQueue = new ToolQueue();

const packageJson = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));

// Create MCP server instance
const server = new McpServer({
  name: "redstring",
  version: packageJson.version,
  capabilities: {
    resources: {},
    tools: {},
  },
});

// Create Express app for HTTP endpoints
const app = express();
// Force 3001 for internal chat/wizard compatibility regardless of .env PORT
// Allow PORT override from environment, default to 3001
// Prefer MCP_PORT, otherwise use PORT (if not 4001), defaulting to 3003
const PORT = process.env.MCP_PORT || (process.env.PORT && process.env.PORT !== '4001' ? process.env.PORT : 3003);
// BRIDGE_PORT: Where the wizard server / UI bridge lives (receives state from BridgeClient.jsx)
// This is separate from PORT because the MCP server reads state FROM the bridge, not from itself.
const BRIDGE_PORT = parseInt(process.env.BRIDGE_PORT || process.env.WIZARD_PORT || '3001', 10);

// The agent server requires its token on every request (C-6). Read it per call
// (env, else ~/.redstring/agent.json for BRIDGE_PORT) so a restarted agent
// server — which mints a new token — is picked up without restarting us.
function agentFetch(url, init = {}) {
  const headers = { ...(init.headers || {}), ...agentAuthHeaders({ port: BRIDGE_PORT }) };
  return fetch(url, { ...init, headers });
}

// The HTTP listener is OFF by default: Claude Desktop and other MCP clients use
// stdio. REDSTRING_MCP_HTTP=1 turns it on (for the /api/mcp/request test
// scripts), always behind the local-server guard with its own token, which is
// recorded under "mcp" in ~/.redstring/agent.json.
const MCP_HTTP_ENABLED = process.env.REDSTRING_MCP_HTTP === '1';
const MCP_HTTP_TOKEN = MCP_HTTP_ENABLED
  ? ((typeof process.env.REDSTRING_MCP_TOKEN === 'string' && process.env.REDSTRING_MCP_TOKEN.trim()) || generateAgentToken())
  : null;

// Helper to map JSON Schema to Zod for dynamic tool registration
function mapJsonSchemaToZod(schema) {
  if (!schema) return z.any();
  const { type, properties, items, required = [], description, enum: enumValues } = schema;

  let zodType;
  if (enumValues) {
    zodType = z.enum(enumValues);
  } else {
    switch (type) {
      case 'string': zodType = z.string(); break;
      case 'number': zodType = z.number(); break;
      case 'boolean': zodType = z.boolean(); break;
      case 'array':
        zodType = z.array(mapJsonSchemaToZod(items));
        break;
      case 'object':
        const shape = {};
        if (properties) {
          for (const [key, prop] of Object.entries(properties)) {
            shape[key] = mapJsonSchemaToZod(prop);
            if (!required.includes(key)) shape[key] = shape[key].optional();
          }
        }
        zodType = z.object(shape);
        break;
      default: zodType = z.any();
    }
  }

  if (description) zodType = zodType.describe(description);
  return zodType;
}

// Map Redstring state to plain objects for wizard tools (which expect arrays/objects)
function toPlainState(state) {
  return {
    ...state,
    graphs: Array.from(state.graphs.values()).map(g => ({
      ...g,
      instances: Array.from(g.instances?.values() || []),
      groups: Array.from(g.groups?.values() || [])
    })),
    nodePrototypes: Array.from(state.nodePrototypes.values()),
    edges: Array.from(state.edges.values())
  };
}

// Register internal/custom tools that don't come from the wizard
async function registerInternalTools() {
  // 1. chat tool
  server.tool(
    "chat",
    "Send a message to the AI model and get a response",
    {
      message: z.string().describe("The message to send to the AI"),
      context: z.object({
        activeGraphId: z.string().nullable().optional(),
        graphCount: z.number().optional(),
        hasAPIKey: z.boolean().optional(),
        preferredModel: z.string().optional()
      }).optional().describe("Context information for the AI"),
      conversationHistory: z.array(z.any()).optional().describe("Previous messages in the conversation"),
      authHeader: z.string().optional().describe("Authorization header (internal use)")
    },
    async ({ message, context = {}, conversationHistory = [], authHeader }) => {
      return toolQueue.enqueue('chat', async () => {
        try {
          const state = await getRealRedstringState();
          const activeGraph = state.activeGraphId ? state.graphs.get(state.activeGraphId) : null;
          const graphInfo = activeGraph ? `${activeGraph.name} (${activeGraph.instances?.size || 0} instances)` : 'No active graph';

          const systemPrompt = `You are an AI assistant helping with a Redstring knowledge graph system. 

Current Context:
- Active Graph: ${graphInfo}
- Total Graphs: ${state.graphs.size}
- Available Concepts: ${state.nodePrototypes.size}
- Available Graphs: ${Array.from(state.graphs.values()).map(g => g.name).join(', ')}

You have access to these tools. Use them to perform actions.
`;

          const headers = { 'Content-Type': 'application/json' };
          if (authHeader) headers['Authorization'] = authHeader;

          const response = await agentFetch(`http://localhost:${BRIDGE_PORT}/api/ai/chat`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              message,
              systemPrompt,
              context,
              model: context.preferredModel,
              conversationHistory
            })
          });

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`AI API call failed: ${response.status} ${errorText}`);
          }

          const data = await response.json();
          return {
            content: [{ type: "text", text: data.response || data.text || '' }]
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true
          };
        }
      });
    }
  );

  // 2. fuzzy open_graph tool
  server.tool(
    "open_graph",
    "Open a graph by ID or name and make it active",
    {
      graphId: z.string().describe("The ID or name of the graph to open"),
      bringToFront: z.boolean().optional().default(true),
      autoExpand: z.boolean().optional().default(true)
    },
    async ({ graphId }) => {
      return toolQueue.enqueue('open_graph', async () => {
        try {
          const state = await getRealRedstringState();
          let targetGraphId = graphId;

          if (!state.graphs.has(graphId)) {
            const lowercaseQuery = graphId.toLowerCase();
            const graphs = Array.from(state.graphs.values());

            const exactMatch = graphs.find(g => g.name.toLowerCase() === lowercaseQuery);
            if (exactMatch) {
              targetGraphId = exactMatch.id;
            } else {
              const partialMatches = graphs.filter(g =>
                g.name.toLowerCase().includes(lowercaseQuery) || lowercaseQuery.includes(g.name.toLowerCase())
              );

              if (partialMatches.length === 1) {
                targetGraphId = partialMatches[0].id;
              } else if (partialMatches.length > 1) {
                return {
                  content: [{ type: "text", text: `Multiple graphs found for "${graphId}": ${partialMatches.map(g => `"${g.name}"`).join(', ')}. Please be more specific.` }]
                };
              } else {
                return {
                  content: [{ type: "text", text: `Graph "${graphId}" not found.` }]
                };
              }
            }
          }

          const graph = state.graphs.get(targetGraphId);
          // Use the prioritized bridge queue (3001)
          const bridgePayload = {
            action: 'openGraph',
            params: [targetGraphId] // Send string ID directly
          };

          const enqueueResp = await agentFetch(`http://127.0.0.1:${BRIDGE_PORT}/api/bridge/pending-actions/enqueue`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ actions: [bridgePayload] })
          });
          const enqueueData = await enqueueResp.json();

          if (enqueueData.ok && enqueueData.actionIds?.length > 0) {
            await waitForActionCompletion(enqueueData.actionIds, 30000);
            // Refresh state to ensure activeGraphId is updated in local MCP cache
            await getRealRedstringState();
          }

          return {
            content: [{ type: "text", text: JSON.stringify({ success: true, graphId: targetGraphId, name: graph.name }) }]
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true
          };
        }
      });
    }
  );

  // 3. list_available_graphs tool
  server.tool(
    "list_available_graphs",
    "List all available graph workspaces",
    {},
    async () => {
      return toolQueue.enqueue('list_available_graphs', async () => {
        try {
          const state = await getRealRedstringState();
          const graphs = Array.from(state.graphs.values());
          const response = `**Available Graphs:**\n${graphs.map(g => `- ${g.name} (${g.id})`).join('\n')}`;
          return { content: [{ type: "text", text: response }] };
        } catch (error) {
          return { content: [{ type: "text", text: `Error listing graphs: ${error.message}` }], isError: true };
        }
      });
    }
  );

  // 3. verify_state tool
  server.tool(
    "verify_state",
    "Verify the current state of the Redstring store and provide explicit debugging information",
    {},
    async () => {
      return toolQueue.enqueue('verify_state', async () => {
        try {
          const state = await getRealRedstringState();
          const response = `**Redstring Store State Verification**\n\n**Store Statistics:**\n- **Total Graphs:** ${state.graphs.size}\n- **Total Prototypes:** ${state.nodePrototypes.size}\n- **Total Edges:** ${state.edges.size}\n- **Open Graphs:** ${state.openGraphIds.length}\n- **Active Graph:** ${state.activeGraphId || 'None'}`;
          return { content: [{ type: "text", text: response }] };
        } catch (error) {
          return { content: [{ type: "text", text: `Error verifying Redstring store state: ${error.message}` }], isError: true };
        }
      });
    }
  );

  // 4. get_spatial_map tool
  server.tool(
    "get_spatial_map",
    "Get a detailed spatial map of the current graph with coordinates, clusters, and layout analysis",
    {
      includeMetadata: z.boolean().optional().describe("Include detailed clustering and layout analysis")
    },
    async ({ includeMetadata = true }) => {
      return toolQueue.enqueue('get_spatial_map', async () => {
        try {
          const state = await getRealRedstringState();
          if (!state || !state.graphs) return { content: [{ type: "text", text: "Error: No state available" }], isError: true };
          let targetGraphId = state.activeGraphId || (state.openGraphIds?.[0]);
          if (!targetGraphId) return { content: [{ type: "text", text: "Error: No active graph" }], isError: true };
          const graph = state.graphs.get(targetGraphId);
          if (!graph) return { content: [{ type: "text", text: "Error: Graph not found" }], isError: true };

          const spatialMap = {
            canvasSize: { width: 1000, height: 600 },
            activeGraph: graph.name,
            nodes: Array.from(graph.instances?.values() || []).map(inst => {
              const proto = state.nodePrototypes.get(inst.prototypeId);
              return { id: inst.id, name: proto?.name, x: inst.x, y: inst.y, color: proto?.color };
            })
          };
          return { content: [{ type: "text", text: JSON.stringify(spatialMap) }] };
        } catch (error) {
          return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
      });
    }
  );

  // 5. navigate_to tool
  server.tool(
    "navigate_to",
    "Navigate the canvas view to show specific nodes or content",
    {
      mode: z.enum(['fit_content', 'focus_nodes', 'coordinates']).optional(),
      nodeIds: z.array(z.string()).optional(),
      coordinates: z.object({ x: z.number(), y: z.number() }).optional(),
      zoom: z.number().optional()
    },
    async (params) => {
      return toolQueue.enqueue('navigate_to', async () => {
        // Use the prioritized bridge queue (3001)
        const bridgePayload = {
          action: 'navigateTo',
          params: [params]
        };

        const enqueueResp = await agentFetch(`http://127.0.0.1:${BRIDGE_PORT}/api/bridge/pending-actions/enqueue`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ actions: [bridgePayload] })
        });
        const enqueueData = await enqueueResp.json();

        if (enqueueData.ok && enqueueData.actionIds?.length > 0) {
          await waitForActionCompletion(enqueueData.actionIds, 10000);
        }

        return { content: [{ type: "text", text: JSON.stringify({ success: true, navigated: true }) }] };
      });
    }
  );

  // 6. apply_mutations tool
  server.tool(
    "apply_mutations",
    "Apply a batch of store mutations in one shot",
    {
      operations: z.array(z.object({}).passthrough()).describe("Array of operations to apply")
    },
    async ({ operations }) => {
      return toolQueue.enqueue('apply_mutations', async () => {
        try {
          const cid = `mcp-${Date.now()}`;
          console.error(`[Bridge] apply_mutations: Enqueuing ${operations.length} operations`);

          // Use the prioritized bridge queue (3001)
          const bridgePayload = {
            action: 'applyMutations',
            params: [operations]
          };

          const enqueueResp = await agentFetch(`http://127.0.0.1:${BRIDGE_PORT}/api/bridge/pending-actions/enqueue`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ actions: [bridgePayload] })
          });
          const enqueueData = await enqueueResp.json();

          let result = { success: true, count: operations.length };

          if (enqueueData.ok && enqueueData.actionIds?.length > 0) {
            console.error(`[MCP] Waiting for batch mutations: ${enqueueData.actionIds.join(', ')}`);
            const waitResult = await waitForActionCompletion(enqueueData.actionIds, 30000);

            if (waitResult.timedOut) {
              console.error(`[MCP] Warning: Batch mutations timed out`);
            } else if (waitResult.completed) {
              console.error(`[MCP] Batch mutations completed successfully`);
              const bridgeResult = waitResult.results[enqueueData.actionIds[0]];
              if (bridgeResult) {
                result = { ...result, ...bridgeResult };
              }
              // Refresh the state immediately
              await getRealRedstringState();
            }
          }

          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        } catch (error) {
          console.error(`[MCP] apply_mutations error:`, error);
          return { content: [{ type: "text", text: JSON.stringify({ error: error.message, status: 'failed' }) }], isError: true };
        }
      });
    }
  );

  // 7. Abstraction tools
  server.tool(
    "abstraction_add",
    "Add a node to an abstraction chain",
    {
      nodeId: z.string(),
      dimension: z.string().default('default'),
      direction: z.enum(['above', 'below']),
      newNodeId: z.string()
    },
    async (args) => {
      return toolQueue.enqueue('abstraction_add', async () => {
        try {
          // Use the prioritized bridge queue (3001)
          const bridgePayload = {
            action: 'applyMutations',
            params: [[{ type: 'addToAbstractionChain', ...args }]]
          };

          const enqueueResp = await agentFetch(`http://127.0.0.1:${BRIDGE_PORT}/api/bridge/pending-actions/enqueue`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ actions: [bridgePayload] })
          });
          const enqueueData = await enqueueResp.json();

          let result = { success: true };

          if (enqueueData.ok && enqueueData.actionIds?.length > 0) {
            const waitResult = await waitForActionCompletion(enqueueData.actionIds, 30000);
            if (waitResult.completed) {
              // Refresh state
              await getRealRedstringState();
            }
          }

          return { content: [{ type: "text", text: JSON.stringify(result) }] };
        } catch (error) {
          return { content: [{ type: "text", text: JSON.stringify({ error: error.message }) }], isError: true };
        }
      });
    }
  );
}

// Wait for the browser to finish executing enqueued actions
async function waitForActionCompletion(actionIds, timeoutMs = 30000) {
  const startTime = Date.now();
  let delay = 100;
  const maxDelay = 500;
  const results = {};

  while (Date.now() - startTime < timeoutMs) {
    let allDone = true;
    for (const actionId of actionIds) {
      try {
        const resp = await agentFetch(`http://127.0.0.1:${BRIDGE_PORT}/api/bridge/action-status/${actionId}`);
        const data = await resp.json();
        if (data.status !== 'completed') {
          allDone = false;
          break;
        } else {
          results[actionId] = data.result;
        }
      } catch {
        allDone = false;
        break;
      }
    }
    if (allDone) return { completed: true, results };
    await new Promise(r => setTimeout(r, delay));
    delay = Math.min(delay * 1.5, maxDelay);
  }
  return { completed: false, timedOut: true, results };
}

// Register all wizard tools as MCP tools
async function registerWizardTools() {
  console.error('[MCP] Registering Wizard tools...');
  const definitions = getToolDefinitions();

  for (const def of definitions) {
    // Filter out tools that are strictly for the Redstring UI and shouldn't be exposed via MCP
    if (def.name === 'askMultipleChoice') {
      continue;
    }

    // Helper to register a tool with a specific name
    const registerWith = (name) => {
      // Skip if already registered manually
      if (server._registeredTools?.[name]) {
        console.error(`[MCP] Skipping existing tool: ${name}`);
        return;
      }

      const shape = {};
      if (def.parameters && def.parameters.properties) {
        for (const [key, prop] of Object.entries(def.parameters.properties)) {
          shape[key] = mapJsonSchemaToZod(prop);
          if (!def.parameters.required?.includes(key)) {
            shape[key] = shape[key].optional();
          }
        }
      }

      server.tool(
        name,
        def.description,
        shape,
        async (args) => {
          return toolQueue.enqueue(name, async () => {
            try {
              // Fetch fresh state before execution
              const state = await getRealRedstringState();
              const plainState = toPlainState(state);
              const cid = `mcp-${Date.now()}`;

              console.error(`[MCP] Executing Wizard tool: ${name} (Mapped to ${def.name})`, args);
              let result = await executeTool(def.name, args, plainState, cid, () => { });

              // If result contains an action, it's a mutation - enqueue it and wait for completion
              if (result && result.action) {
                console.error(`[MCP] Enqueuing mutation from tool ${name}:`, result.action);
                try {
                  const bridgePayload = {
                    action: result.action,
                    params: [result] // Pass the whole result object as the single parameter
                  };

                  const enqueueResp = await agentFetch(`http://127.0.0.1:${BRIDGE_PORT}/api/bridge/pending-actions/enqueue`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ actions: [bridgePayload] })
                  });
                  const enqueueData = await enqueueResp.json();

                  // Wait for the browser to actually execute the action
                  if (enqueueData.ok && enqueueData.actionIds?.length > 0) {
                    console.error(`[MCP] Waiting for action completion: ${enqueueData.actionIds.join(', ')}`);
                    const waitResult = await waitForActionCompletion(enqueueData.actionIds, 30000);

                    if (waitResult.timedOut) {
                      console.error(`[MCP] Warning: Action completion timed out for ${name}`);
                    } else if (waitResult.completed) {
                      console.error(`[MCP] Action completed successfully for ${name}`);
                      // Capture the real result from the bridge (enriched with IDs)
                      const bridgeResult = waitResult.results[enqueueData.actionIds[0]];
                      if (bridgeResult) {
                        result = { ...result, ...bridgeResult };
                      }

                      // CRITICAL: Refresh the state immediately after mutation
                      await getRealRedstringState();
                    }
                  }
                } catch (err) {
                  console.error(`[MCP] Failed to enqueue mutation: ${err.message}`);
                }
              }

              // Return full JSON result for ALL tools to enable immediate chaining
              return {
                content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
              };
            } catch (error) {
              console.error(`[MCP] Wizard tool ${name} error:`, error);
              return {
                content: [{ type: "text", text: JSON.stringify({ error: error.message, status: 'failed' }) }],
                isError: true
              };
            }
          });
        }
      );
    };

    // Register with camelCase name only — snake_case duplicates double the tool
    // count and push Gemini (and other constrained LLMs) over schema limits.
    registerWith(def.name);
  }
}

async function registerAllTools() {
  await registerInternalTools();
  await registerWizardTools();
}

console.error(`[MCP] Configured to run on port ${PORT}, reading bridge state from port ${BRIDGE_PORT}`);

// Respect proxy headers when running behind Cloudflare/NGINX
const TRUST_PROXY = process.env.TRUST_PROXY;
if (TRUST_PROXY) {
  if (TRUST_PROXY === 'true') {
    app.set('trust proxy', 1);
  } else if (TRUST_PROXY === 'false') {
    app.set('trust proxy', false);
  } else if (!Number.isNaN(Number(TRUST_PROXY))) {
    app.set('trust proxy', Number(TRUST_PROXY));
  } else {
    app.set('trust proxy', TRUST_PROXY);
  }
}

// Middleware. The guard (Host, Origin, token, JSON-only) runs before anything
// else and answers CORS itself; only JSON bodies are parsed — no form bodies,
// which are what cross-site pages can send without a preflight.
app.use(createLocalServerGuard({
  token: () => MCP_HTTP_TOKEN,
  port: () => Number(PORT),
  allowedOrigins: allowedOriginsFromEnv(process.env.REDSTRING_AGENT_ALLOWED_ORIGINS),
}));
app.use(express.json({ limit: '5mb' }));

// Make crashes visible and keep HTTP alive for wizard/health
process.title = process.title || 'redstring-mcp-server';
process.on('uncaughtException', (err) => {
  try {
    console.error('❌ Uncaught exception:', err?.stack || err);
  } catch { }
});
process.on('unhandledRejection', (reason) => {
  try {
    console.error('❌ Unhandled rejection:', reason);
  } catch { }
});

// Early health check (so the wizard sees us even if later code fails)
app.get('/health', (req, res) => {
  res.json({ status: 'ok', stage: 'boot', timestamp: new Date().toISOString() });
});

// Start HTTP/HTTPS server IMMEDIATELY so /health responds before any async init
const requestedHttps = process.env.MCP_USE_HTTPS === 'true';
const createNetworkServer = () => {
  if (requestedHttps) {
    try {
      const keyPath = process.env.MCP_SSL_KEY_PATH;
      const certPath = process.env.MCP_SSL_CERT_PATH;
      if (!keyPath || !certPath) {
        console.error('⚠️ MCP_USE_HTTPS=true but MCP_SSL_KEY_PATH or MCP_SSL_CERT_PATH is missing. Falling back to HTTP.');
      } else {
        const tlsOptions = {
          key: fs.readFileSync(keyPath, 'utf8'),
          cert: fs.readFileSync(certPath, 'utf8'),
        };
        if (process.env.MCP_SSL_CA_PATH && fs.existsSync(process.env.MCP_SSL_CA_PATH)) {
          tlsOptions.ca = fs.readFileSync(process.env.MCP_SSL_CA_PATH, 'utf8');
        }
        if (process.env.MCP_SSL_PASSPHRASE) {
          tlsOptions.passphrase = process.env.MCP_SSL_PASSPHRASE;
        }
        return { server: https.createServer(tlsOptions, app), protocol: 'https' };
      }
    } catch (error) {
      console.error('⚠️  Failed to initialize HTTPS for MCP server:', error?.message || error);
      console.error('    Falling back to HTTP.');
    }
  }
  return { server: http.createServer(app), protocol: 'http' };
};

const { server: networkServer, protocol: networkProtocol } = createNetworkServer();
// HTTP listen is deferred to main() — stdio must connect first to keep the event loop alive.

// (The early duplicate bridge, /api/ai/agent and /api/wizard routes were removed:
// the agent server on BRIDGE_PORT owns them. See the note near the MCP request endpoint.)

// Bridge to the real Redstring store
// This will be populated when the Redstring app is running
let redstringStoreBridge = null;

// Store for the bridge data (initialize with a heartbeat so the wizard sees Redstring alive)
let bridgeStoreData = {
  graphs: [],
  nodePrototypes: [],
  activeGraphId: null,
  openGraphIds: [],
  summary: {
    totalGraphs: 0,
    totalPrototypes: 0,
    lastUpdate: Date.now()
  },
  graphLayouts: {},
  graphSummaries: {},
  source: 'server-initial'
};

// Pending actions queue must be initialized BEFORE any routes/tools use it
let pendingActions = [];
let inflightActionIds = new Set();

// MCP connection state (always true since we're the MCP server)
let mcpConnected = true;

// Spatial analysis functions for intelligent layout
function analyzeClusters(nodes) {
  const clusters = {};
  const clusterRadius = 150; // pixels

  // Group nodes by proximity
  const processed = new Set();
  let clusterIndex = 0;

  for (const node of nodes) {
    if (processed.has(node.id)) continue;

    const clusterId = `cluster_${clusterIndex++}`;
    const cluster = {
      center: [node.x, node.y],
      nodes: [node.id],
      density: 1,
      bounds: { minX: node.x, maxX: node.x, minY: node.y, maxY: node.y }
    };

    // Find nearby nodes
    for (const otherNode of nodes) {
      if (otherNode.id === node.id || processed.has(otherNode.id)) continue;

      const distance = Math.sqrt(
        Math.pow(node.x - otherNode.x, 2) + Math.pow(node.y - otherNode.y, 2)
      );

      if (distance <= clusterRadius) {
        cluster.nodes.push(otherNode.id);
        cluster.bounds.minX = Math.min(cluster.bounds.minX, otherNode.x);
        cluster.bounds.maxX = Math.max(cluster.bounds.maxX, otherNode.x);
        cluster.bounds.minY = Math.min(cluster.bounds.minY, otherNode.y);
        cluster.bounds.maxY = Math.max(cluster.bounds.maxY, otherNode.y);
        processed.add(otherNode.id);
      }
    }

    // Calculate cluster center and density
    if (cluster.nodes.length > 1) {
      const centerX = (cluster.bounds.minX + cluster.bounds.maxX) / 2;
      const centerY = (cluster.bounds.minY + cluster.bounds.maxY) / 2;
      cluster.center = [centerX, centerY];
      cluster.density = cluster.nodes.length / (clusterRadius * clusterRadius / 10000);

      clusters[clusterId] = cluster;
    }

    processed.add(node.id);
  }

  return clusters;
}

function findEmptyRegions(nodes, canvasSize) {
  const regions = [];
  const gridSize = 100;
  const nodeRadius = 50; // Minimum distance from nodes

  // Create a grid and check for empty areas
  for (let x = 350; x < canvasSize.width - 100; x += gridSize) {
    for (let y = 100; y < canvasSize.height - 100; y += gridSize) {
      let isEmpty = true;

      // Check if this grid cell is far enough from all nodes
      for (const node of nodes) {
        const distance = Math.sqrt(
          Math.pow(x - node.x, 2) + Math.pow(y - node.y, 2)
        );
        if (distance < nodeRadius * 2) {
          isEmpty = false;
          break;
        }
      }

      if (isEmpty) {
        regions.push({
          x: x,
          y: y,
          width: gridSize,
          height: gridSize,
          suitability: x > 400 && x < 600 && y > 150 && y < 350 ? "high" : "medium"
        });
      }
    }
  }

  return regions;
}

function generateLayoutSuggestions(nodes, clusters) {
  const suggestions = {
    nextPlacement: null,
    clusterExpansion: [],
    layoutImprovements: []
  };

  // Find best placement for next node
  if (Object.keys(clusters).length > 0) {
    // Suggest placement near existing clusters but not overlapping
    const mainCluster = Object.values(clusters)[0];
    suggestions.nextPlacement = {
      x: mainCluster.center[0] + 200,
      y: mainCluster.center[1],
      reasoning: "Near main cluster but with spacing"
    };
  } else {
    // No clusters, suggest center-right placement
    suggestions.nextPlacement = {
      x: 500,
      y: 250,
      reasoning: "Central placement for first node"
    };
  }

  // Suggest cluster expansion directions
  for (const [clusterId, cluster] of Object.entries(clusters)) {
    if (cluster.density > 0.5) {
      suggestions.clusterExpansion.push({
        clusterId,
        direction: "southeast",
        reasoning: "Cluster is getting dense, expand outward"
      });
    }
  }

  return suggestions;
}

// Node dimension constants (matching constants.js)
const NODE_WIDTH = 150;
const NODE_HEIGHT = 100;
const EXPANDED_NODE_WIDTH = 300; // For nodes with images
const NODE_PADDING = 30;

// Calculate actual node dimensions (simplified version of getNodeDimensions)
function calculateNodeDimensions(conceptName, hasImage = false) {
  // Basic dimension calculation
  const baseWidth = hasImage ? EXPANDED_NODE_WIDTH : NODE_WIDTH;
  const baseHeight = NODE_HEIGHT;

  // Text width estimation (rough approximation)
  const avgCharWidth = 9;
  const textWidth = conceptName.length * avgCharWidth;
  const needsWrap = textWidth > (baseWidth - 2 * NODE_PADDING);

  return {
    width: baseWidth,
    height: needsWrap ? baseHeight + 20 : baseHeight, // Add height if text wraps
    bounds: {
      width: baseWidth,
      height: needsWrap ? baseHeight + 20 : baseHeight
    }
  };
}

// Generate intelligent batch layout considering actual node boundaries
function generateBatchLayout(clusters, spatialMap, layout, nodeSpacing) {
  const positions = {};
  const clusterNames = Object.keys(clusters);

  // Find starting position (avoid existing nodes and panels)
  let startX = 400; // Past left panel
  let startY = 150; // Below header

  // If there are existing nodes, find good placement area
  if (spatialMap.nodes && spatialMap.nodes.length > 0) {
    const existingBounds = calculateExistingBounds(spatialMap.nodes);
    startX = Math.max(startX, existingBounds.maxX + nodeSpacing.clusterGap);
  }

  // Use empty regions if available
  if (spatialMap.emptyRegions && spatialMap.emptyRegions.length > 0) {
    const bestRegion = spatialMap.emptyRegions.find(r => r.suitability === "high") || spatialMap.emptyRegions[0];
    startX = bestRegion.x;
    startY = bestRegion.y;
  }

  switch (layout) {
    case "hierarchical":
      return generateHierarchicalLayout(clusters, startX, startY, nodeSpacing);
    case "radial":
      return generateRadialLayout(clusters, startX, startY, nodeSpacing);
    case "linear":
      return generateLinearLayout(clusters, startX, startY, nodeSpacing);
    case "clustered":
    default:
      return generateClusteredLayout(clusters, startX, startY, nodeSpacing);
  }
}

// Generate clustered layout with proper boundary consideration
function generateClusteredLayout(clusters, startX, startY, nodeSpacing) {
  const positions = {};
  const clusterNames = Object.keys(clusters);
  let currentClusterX = startX;

  clusterNames.forEach((clusterName, clusterIndex) => {
    const concepts = clusters[clusterName];
    let maxClusterWidth = 0;
    let currentY = startY;
    let currentX = currentClusterX;
    let rowWidth = 0;
    let maxRowHeight = 0;

    // Calculate optimal grid layout for this cluster
    const conceptsPerRow = Math.ceil(Math.sqrt(concepts.length));

    concepts.forEach((concept, index) => {
      const dimensions = calculateNodeDimensions(concept.name);

      // Check if we need to start a new row
      if (index > 0 && index % conceptsPerRow === 0) {
        currentY += maxRowHeight + nodeSpacing.vertical;
        currentX = currentClusterX;
        rowWidth = 0;
        maxRowHeight = 0;
      }

      positions[concept.name] = {
        x: currentX,
        y: currentY,
        cluster: clusterName,
        dimensions: dimensions
      };

      // Update positioning for next node
      currentX += dimensions.width + nodeSpacing.horizontal;
      rowWidth += dimensions.width + nodeSpacing.horizontal;
      maxRowHeight = Math.max(maxRowHeight, dimensions.height);
      maxClusterWidth = Math.max(maxClusterWidth, rowWidth);
    });

    // Move to next cluster position
    currentClusterX += maxClusterWidth + nodeSpacing.clusterGap;
  });

  return positions;
}

// Generate hierarchical layout (top-down tree structure)
function generateHierarchicalLayout(clusters, startX, startY, nodeSpacing) {
  const positions = {};
  const clusterNames = Object.keys(clusters);
  let currentY = startY;

  clusterNames.forEach((clusterName, clusterIndex) => {
    const concepts = clusters[clusterName];
    let currentX = startX;

    concepts.forEach((concept, index) => {
      const dimensions = calculateNodeDimensions(concept.name);

      positions[concept.name] = {
        x: currentX,
        y: currentY,
        cluster: clusterName,
        level: clusterIndex, // Hierarchical level
        dimensions: dimensions
      };

      currentX += dimensions.width + nodeSpacing.horizontal;
    });

    currentY += NODE_HEIGHT + nodeSpacing.vertical * 1.5; // Extra spacing between levels
  });

  return positions;
}

// Generate radial layout (concepts arranged in circles)
function generateRadialLayout(clusters, startX, startY, nodeSpacing) {
  const positions = {};
  const centerX = startX + 200;
  const centerY = startY + 200;
  const clusterNames = Object.keys(clusters);

  clusterNames.forEach((clusterName, clusterIndex) => {
    const concepts = clusters[clusterName];
    const radius = 150 + (clusterIndex * 100); // Expanding circles
    const angleStep = (2 * Math.PI) / concepts.length;

    concepts.forEach((concept, index) => {
      const angle = index * angleStep;
      const x = centerX + radius * Math.cos(angle);
      const y = centerY + radius * Math.sin(angle);
      const dimensions = calculateNodeDimensions(concept.name);

      positions[concept.name] = {
        x: x - dimensions.width / 2, // Center the node
        y: y - dimensions.height / 2,
        cluster: clusterName,
        angle: angle,
        radius: radius,
        dimensions: dimensions
      };
    });
  });

  return positions;
}

// Generate linear layout (concepts in rows)
function generateLinearLayout(clusters, startX, startY, nodeSpacing) {
  const positions = {};
  let currentX = startX;
  let currentY = startY;

  // Flatten all concepts into a single sequence
  const allConcepts = [];
  Object.keys(clusters).forEach(clusterName => {
    clusters[clusterName].forEach(concept => {
      allConcepts.push({ ...concept, cluster: clusterName });
    });
  });

  const conceptsPerRow = 4; // Fixed row width

  allConcepts.forEach((concept, index) => {
    if (index > 0 && index % conceptsPerRow === 0) {
      currentY += NODE_HEIGHT + nodeSpacing.vertical;
      currentX = startX;
    }

    const dimensions = calculateNodeDimensions(concept.name);

    positions[concept.name] = {
      x: currentX,
      y: currentY,
      cluster: concept.cluster,
      row: Math.floor(index / conceptsPerRow),
      dimensions: dimensions
    };

    currentX += dimensions.width + nodeSpacing.horizontal;
  });

  return positions;
}

// Helper function to calculate bounds of existing nodes
function calculateExistingBounds(nodes) {
  if (!nodes.length) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  nodes.forEach(node => {
    // Estimate node dimensions (we don't have access to getNodeDimensions here)
    const width = node.hasImage ? EXPANDED_NODE_WIDTH : NODE_WIDTH;
    const height = NODE_HEIGHT;

    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + width);
    maxY = Math.max(maxY, node.y + height);
  });

  return { minX, minY, maxX, maxY };
}

// Helper function to build spatial map directly from state
async function buildSpatialMapFromState(state) {
  const spatialMap = {
    canvasSize: { width: 1000, height: 600 },
    nodes: [],
    clusters: {},
    emptyRegions: [],
    panelConstraints: {
      leftPanel: { x: 0, width: 300, description: "Avoid placing nodes here" },
      header: { y: 0, height: 80, description: "Keep nodes below this" },
      rightPanel: { x: 750, width: 250, description: "Right panel may cover this area" }
    }
  };

  if (!state || !state.activeGraphId) {
    console.error('🔍 buildSpatialMapFromState: No state or activeGraphId');
    spatialMap.emptyRegions = [{ x: 400, y: 150, width: 400, height: 300, suitability: "high" }];
    return spatialMap;
  }

  const graph = state.graphs?.get ? state.graphs.get(state.activeGraphId) : null;
  if (!graph) {
    console.error('🔍 buildSpatialMapFromState: No graph found for activeGraphId:', state.activeGraphId);
    spatialMap.emptyRegions = [{ x: 400, y: 150, width: 400, height: 300, suitability: "high" }];
    return spatialMap;
  }

  console.error('🔍 buildSpatialMapFromState: Found graph with instances:', {
    graphId: state.activeGraphId,
    hasInstances: !!graph.instances,
    instancesType: typeof graph.instances,
    instancesSize: graph.instances?.size,
    isMap: graph.instances instanceof Map
  });

  // The bridge may not provide instance data, so handle that gracefully
  const instances = graph.instances;
  if (instances && typeof instances.values === 'function') {
    // Extract node positions and metadata if instances exist
    const nodeInstances = Array.from(instances.values());
    console.error('🔍 buildSpatialMapFromState: Processing instances:', {
      instancesCount: nodeInstances.length,
      firstInstance: nodeInstances[0]
    });

    for (const instance of nodeInstances) {
      if (instance && instance.prototypeId) {
        const prototype = state.nodePrototypes?.get ? state.nodePrototypes.get(instance.prototypeId) : null;
        if (prototype) {
          spatialMap.nodes.push({
            id: instance.id,
            name: prototype.name,
            x: instance.x || 0,
            y: instance.y || 0,
            scale: instance.scale || 1,
            color: prototype.color,
            prototypeId: instance.prototypeId
          });
        }
      }
    }

    console.error('🔍 buildSpatialMapFromState: Final spatial nodes:', spatialMap.nodes.length);
  } else {
    console.error('🔍 buildSpatialMapFromState: No valid instances found:', {
      hasInstances: !!instances,
      hasValuesMethod: instances && typeof instances.values === 'function'
    });
  }

  // Analyze clusters and find empty regions
  spatialMap.clusters = analyzeClusters(spatialMap.nodes);
  spatialMap.emptyRegions = findEmptyRegions(spatialMap.nodes, spatialMap.canvasSize);

  return spatialMap;
}

// Normalize bridge state into Map-like structures expected by server tooling
function normalizeStateFromBridge(raw) {
  if (!raw || typeof raw !== 'object') return raw;
  const normalized = { ...raw };
  // Graphs
  if (!(raw.graphs instanceof Map)) {
    const graphEntries = Array.isArray(raw.graphs) ? raw.graphs : [];
    const graphsMap = new Map();
    for (const g of graphEntries) {
      const instancesMap = g && g.instances && typeof g.instances === 'object' && !(g.instances instanceof Map)
        ? new Map(Object.entries(g.instances || {}))
        : (g?.instances instanceof Map ? g.instances : new Map());
      graphsMap.set(g.id, { ...g, instances: instancesMap });
    }
    normalized.graphs = graphsMap;
  }
  // Node prototypes
  if (!(raw.nodePrototypes instanceof Map)) {
    const protoEntries = Array.isArray(raw.nodePrototypes) ? raw.nodePrototypes : [];
    const protosMap = new Map();
    for (const p of protoEntries) {
      if (p && p.id) protosMap.set(p.id, p);
    }
    normalized.nodePrototypes = protosMap;
  }
  // Edges (optional)
  if (raw.edges && !(raw.edges instanceof Map)) {
    const edgeEntries = Array.isArray(raw.edges) ? raw.edges : [];
    const edgesMap = new Map();
    for (const e of edgeEntries) {
      if (e && e.id) edgesMap.set(e.id, e);
    }
    normalized.edges = edgesMap;
  }
  return normalized;
}

// Helper function to create a concept with position
async function createConceptWithPosition(targetGraphId, concept, positionData) {
  const position = {
    x: positionData.x,
    y: positionData.y
  };

  console.error(`📍 Creating "${concept.name}" at (${position.x}, ${position.y}) in cluster "${positionData.cluster}"`);

  // Use the existing addNodeToGraph logic
  const prototypeId = `prototype-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  await actions.addNodePrototype(prototypeId, concept.name, concept.description || '', '#8B0000');
  await new Promise(resolve => setTimeout(resolve, 2500)); // Wait for prototype sync

  await actions.addNodeInstance(targetGraphId, prototypeId, position);
  await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for instance sync

  return {
    name: concept.name,
    success: true,
    position: position,
    cluster: positionData.cluster,
    prototypeId: prototypeId
  };
}

// Helper function to check if bridge is responsive
async function checkBridgeHealth() {
  try {
    const response = await agentFetch(`http://localhost:${BRIDGE_PORT}/api/bridge/health`);
    return response.ok;
  } catch (error) {
    return false;
  }
}

// Function to get the real Redstring store state via HTTP request with intelligent retry
async function getRealRedstringState(retryCount = 0) {
  const maxRetries = 3;
  const baseRetryDelay = 1000; // Base delay of 1 second
  const retryDelay = baseRetryDelay * Math.pow(2, retryCount); // Exponential backoff

  try {
    // Try to fetch from the bridge endpoint
    const response = await agentFetch(`http://localhost:${BRIDGE_PORT}/api/bridge/state`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const data = await response.json();

    // Debug: Check what bridge is sending
    console.error('🔍 Bridge data received:', {
      totalGraphs: data.graphs?.length,
      activeGraphId: data.activeGraphId,
      activeGraphData: data.graphs?.find(g => g.id === data.activeGraphId)
    });

    // Validate we got valid data
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid data structure received from bridge');
    }

    // Convert the minimal data format back to the expected structure
    const state = {
      graphs: new Map((data.graphs || []).map(graph => {
        const instancesMap = graph.instances ? new Map(Object.entries(graph.instances)) : new Map();

        // Deserialize groups if present (sent as array, convert to array for tool compatibility)
        const groups = Array.isArray(graph.groups) ? graph.groups : [];

        return [graph.id, {
          ...graph,
          instances: instancesMap,
          groups
        }];
      })),
      nodePrototypes: new Map((data.nodePrototypes || []).map(prototype => [prototype.id, prototype])),
      edges: new Map((data.graphEdges || []).map(edge => [edge.id, edge])),
      activeGraphId: data.activeGraphId,
      openGraphIds: data.openGraphIds || [],
      expandedGraphIds: new Set(),
      savedNodeIds: new Set(),
      savedGraphIds: new Set(),
      summary: data.summary
    };

    // If we get here, the fetch succeeded
    if (retryCount > 0) {
      console.error(`✅ Bridge state fetch succeeded after ${retryCount} retries`);
    }

    return state;
  } catch (error) {
    const isNetworkError = error.message.includes('fetch') ||
      error.message.includes('ECONNREFUSED') ||
      error.message.includes('500') ||
      error.message.includes('503') ||
      error.message.includes('Invalid data structure');

    // Only retry on network/temporary errors, not on fundamental connection issues
    if (isNetworkError && retryCount < maxRetries) {
      console.error(`🔄 Bridge state fetch failed (attempt ${retryCount + 1}/${maxRetries + 1}): ${error.message}`);
      console.error(`   Retrying in ${retryDelay}ms...`);

      await new Promise(resolve => setTimeout(resolve, retryDelay));
      return getRealRedstringState(retryCount + 1);
    }

    // If we've exhausted retries or it's a fundamental error, throw
    const errorPrefix = retryCount > 0 ?
      `After ${retryCount + 1} attempts, bridge` :
      'Redstring store bridge';

    throw new Error(`${errorPrefix} not available: ${error.message}. Start either the Redstring app in a browser (which loads the MCPBridge) OR the headless daemon (\`npm run daemon\` with a universe configured via --universe / REDSTRING_UNIVERSE). Both serve the bridge on localhost:${BRIDGE_PORT}.`);
  }
}

// Function to access real Redstring store actions via HTTP bridge
function getRealRedstringActions() {
  return {
    // Create a new empty graph and set it active via pending action
    createNewGraph: async (initialData = {}) => {
      try {
        const pendingAction = {
          id: `pa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          action: 'createNewGraph',
          params: [initialData],
          timestamp: Date.now()
        };
        pendingActions.push(pendingAction);
        console.error('✅ Bridge: Queued createNewGraph action');
        await new Promise(resolve => setTimeout(resolve, 500));
        return { success: true };
      } catch (error) {
        console.error('❌ Bridge: Failed to queue createNewGraph action:', error.message);
        throw error;
      }
    },

    // Create and activate a definition graph for a prototype
    createAndAssignGraphDefinition: async (prototypeId) => {
      try {
        const pendingAction = {
          id: `pa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          action: 'createAndAssignGraphDefinition',
          params: [prototypeId],
          timestamp: Date.now()
        };
        pendingActions.push(pendingAction);
        console.error('✅ Bridge: Queued createAndAssignGraphDefinition action for', prototypeId);
        await new Promise(resolve => setTimeout(resolve, 500));
        return { success: true, prototypeId };
      } catch (error) {
        console.error('❌ Bridge: Failed to queue createAndAssignGraphDefinition action:', error.message);
        throw error;
      }
    },

    // Open right panel node tab
    openRightPanelNodeTab: async (nodeId) => {
      try {
        const pendingAction = {
          id: `pa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          action: 'openRightPanelNodeTab',
          params: [nodeId],
          timestamp: Date.now()
        };
        pendingActions.push(pendingAction);
        console.error('✅ Bridge: Queued openRightPanelNodeTab for', nodeId);
        await new Promise(resolve => setTimeout(resolve, 300));
        return { success: true, nodeId };
      } catch (error) {
        console.error('❌ Bridge: Failed to queue openRightPanelNodeTab:', error.message);
        throw error;
      }
    },

    // Add edge through store action
    addEdge: async (graphId, edgeData) => {
      try {
        const pendingAction = {
          id: `pa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          action: 'addEdge',
          params: [graphId, edgeData],
          timestamp: Date.now()
        };
        pendingActions.push(pendingAction);
        console.error('✅ Bridge: Queued addEdge', { graphId, edgeId: edgeData?.id });
        await new Promise(resolve => setTimeout(resolve, 300));
        return { success: true, edgeId: edgeData?.id };
      } catch (error) {
        console.error('❌ Bridge: Failed to queue addEdge:', error.message);
        throw error;
      }
    },

    // Update edge directionality arrowsToward via store
    updateEdgeDirectionality: async (edgeId, arrowsToward) => {
      try {
        const pendingAction = {
          id: `pa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          action: 'updateEdgeDirectionality',
          params: [edgeId, arrowsToward],
          timestamp: Date.now()
        };
        pendingActions.push(pendingAction);
        console.error('✅ Bridge: Queued updateEdgeDirectionality', { edgeId });
        await new Promise(resolve => setTimeout(resolve, 300));
        return { success: true, edgeId };
      } catch (error) {
        console.error('❌ Bridge: Failed to queue updateEdgeDirectionality:', error.message);
        throw error;
      }
    },

    // Batch apply multiple mutations inside the UI store
    applyMutations: async (operations = []) => {
      try {
        const pendingAction = {
          id: `pa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          action: 'applyMutations',
          params: [operations],
          timestamp: Date.now()
        };
        pendingActions.push(pendingAction);
        console.error(`✅ Bridge: Queued applyMutations with ${operations.length} ops`);
        await new Promise(resolve => setTimeout(resolve, Math.min(operations.length * 50, 1500)));
        return { success: true, count: operations.length };
      } catch (error) {
        console.error('❌ Bridge: Failed to queue applyMutations:', error.message);
        throw error;
      }
    },
    addNodePrototype: async (prototypeData) => {
      try {
        // Use pending actions system instead of HTTP endpoints
        const prototypeId = `prototype-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const pendingAction = {
          id: `pa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          action: 'addNodePrototype',
          params: [prototypeId, prototypeData],
          timestamp: Date.now()
        };

        pendingActions.push(pendingAction);
        console.error(`✅ Bridge: Queued addNodePrototype action for ${prototypeData.name}`);

        // Wait a moment for the action to be processed
        await new Promise(resolve => setTimeout(resolve, 500));

        return { success: true, prototypeId };
      } catch (error) {
        console.error('❌ Bridge: Failed to queue add prototype action:', error.message);
        throw error;
      }
    },
    addNodeInstance: async (graphId, prototypeId, position) => {
      try {
        // Use pending actions system instead of HTTP endpoints
        const pendingAction = {
          id: `pa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          action: 'addNodeInstance',
          params: [graphId, prototypeId, position],
          timestamp: Date.now()
        };

        pendingActions.push(pendingAction);
        console.error(`✅ Bridge: Queued addNodeInstance action for graph ${graphId}, prototype ${prototypeId}`);

        // Wait a moment for the action to be processed
        await new Promise(resolve => setTimeout(resolve, 1000));

        return { success: true, instanceId: `pending-${Date.now()}` };
      } catch (error) {
        console.error('❌ Bridge: Failed to queue add instance action:', error.message);
        throw error;
      }
    },
    setActiveGraphId: async (graphId) => {
      try {
        // Use pending actions system instead of HTTP endpoints
        const pendingAction = {
          id: `pa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          action: 'setActiveGraph',
          params: [graphId],
          timestamp: Date.now()
        };

        pendingActions.push(pendingAction);
        console.error(`✅ Bridge: Queued setActiveGraph action for ${graphId}`);

        // Wait a moment for the action to be processed
        await new Promise(resolve => setTimeout(resolve, 500));

        return { success: true, graphId };
      } catch (error) {
        console.error('❌ Bridge: Failed to queue set active graph action:', error.message);
        throw error;
      }
    },

    openGraphTabAndBringToTop: async (graphId) => {
      try {
        // Use pending actions system instead of HTTP endpoints
        const pendingAction = {
          id: `pa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          action: 'openGraph',
          params: [graphId],
          timestamp: Date.now()
        };

        pendingActions.push(pendingAction);
        console.error(`✅ Bridge: Queued openGraph action for ${graphId}`);

        // Wait a moment for the action to be processed
        await new Promise(resolve => setTimeout(resolve, 500));

        return { success: true, graphId };
      } catch (error) {
        console.error('❌ Bridge: Failed to queue open graph action:', error.message);
        throw error;
      }
    },

    openGraphTab: async (graphId) => {
      try {
        // Use pending actions system instead of HTTP endpoints
        const pendingAction = {
          id: `pa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          action: 'openGraph',
          params: [graphId],
          timestamp: Date.now()
        };

        pendingActions.push(pendingAction);
        console.error(`✅ Bridge: Queued openGraph action for ${graphId}`);

        // Wait a moment for the action to be processed
        await new Promise(resolve => setTimeout(resolve, 500));

        return { success: true, graphId };
      } catch (error) {
        console.error('❌ Bridge: Failed to queue open graph action:', error.message);
        throw error;
      }
    },

    createAndAssignGraphDefinitionWithoutActivation: async (prototypeId) => {
      try {
        const response = await agentFetch(`http://localhost:${BRIDGE_PORT}/api/bridge/actions/create-graph-definition`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ prototypeId, activate: false })
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const result = await response.json();
        console.error('✅ Bridge: Graph definition created successfully');
        return result.graphId;
      } catch (error) {
        console.error('❌ Bridge: Failed to create graph definition:', error.message);
        throw error;
      }
    },

    updateNodePrototype: async (prototypeId, updates) => {
      try {
        // Use pending actions system instead of HTTP endpoints
        const pendingAction = {
          id: `pa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          action: 'updateNodePrototype',
          params: [prototypeId, updates],
          timestamp: Date.now()
        };

        pendingActions.push(pendingAction);
        console.error(`✅ Bridge: Queued updateNodePrototype action for prototype ${prototypeId}`);

        // Wait a moment for the action to be processed
        await new Promise(resolve => setTimeout(resolve, 500));

        return { success: true, prototypeId };
      } catch (error) {
        console.error('❌ Bridge: Failed to queue update prototype action:', error.message);
        throw error;
      }
    },

    deleteNodeInstance: async (graphId, instanceId) => {
      try {
        // Use pending actions system instead of HTTP endpoints
        const pendingAction = {
          id: `pa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          action: 'removeNodeInstance',
          params: [graphId, instanceId],
          timestamp: Date.now()
        };

        pendingActions.push(pendingAction);
        console.error(`✅ Bridge: Queued removeNodeInstance action for graph ${graphId}, instance ${instanceId}`);

        // Wait a moment for the action to be processed
        await new Promise(resolve => setTimeout(resolve, 500));

        return { success: true, instanceId };
      } catch (error) {
        console.error('❌ Bridge: Failed to queue remove instance action:', error.message);
        throw error;
      }
    },

    createEdge: async (graphId, sourceId, targetId, edgeType, weight) => {
      try {
        const response = await agentFetch(`http://localhost:${BRIDGE_PORT}/api/bridge/actions/create-edge`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ graphId, sourceId, targetId, edgeType, weight })
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const result = await response.json();
        console.error('✅ Bridge: Edge created successfully');
        return result;
      } catch (error) {
        console.error('❌ Bridge: Failed to create edge:', error.message);
        throw error;
      }
    },

    createEdgeDefinition: async (edgeDefinitionData) => {
      try {
        const response = await agentFetch(`http://localhost:${BRIDGE_PORT}/api/bridge/actions/create-edge-definition`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(edgeDefinitionData)
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const result = await response.json();
        console.error('✅ Bridge: Edge definition created successfully');
        return result;
      } catch (error) {
        console.error('❌ Bridge: Failed to create edge definition:', error.message);
        throw error;
      }
    },

    moveNodeInstance: async (graphId, instanceId, position) => {
      try {
        const response = await agentFetch(`http://localhost:${BRIDGE_PORT}/api/bridge/actions/move-node-instance`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ graphId, instanceId, position })
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const result = await response.json();
        console.error('✅ Bridge: Node instance moved successfully');
        return result;
      } catch (error) {
        console.error('❌ Bridge: Failed to move node instance:', error.message);
        throw error;
      }
    },

    searchNodes: async (query, graphId) => {
      try {
        const response = await agentFetch(`http://localhost:${BRIDGE_PORT}/api/bridge/actions/search-nodes`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ query, graphId })
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const result = await response.json();
        console.error('✅ Bridge: Node search completed successfully');
        return result;
      } catch (error) {
        console.error('❌ Bridge: Failed to search nodes:', error.message);
        throw error;
      }
    }
  };
}

// Helper function to get graph data from the real Redstring store
async function getGraphData() {
  try {
    const state = await getRealRedstringState();

    console.error('DEBUG: State received:', {
      hasGraphs: !!state.graphs,
      graphsType: typeof state.graphs,
      graphsSize: state.graphs?.size,
      graphsKeys: state.graphs ? Array.from(state.graphs.keys()).slice(0, 3) : []
    });

    // Convert the real Redstring store structure to a format suitable for MCP tools
    const graphs = {};

    // Safely iterate over the Map
    if (state.graphs && state.graphs instanceof Map && state.graphs.size > 0) {
      state.graphs.forEach((graph, graphId) => {
        // Bridge data has minimal graph info, not full instances
        graphs[graphId] = {
          id: graphId,
          name: graph.name,
          description: graph.description || '',
          nodes: [], // Bridge doesn't send full instance data
          edges: [], // Bridge doesn't send edge data
          nodeCount: graph.instanceCount || 0,
          edgeCount: 0,
          instances: new Map(), // Empty since bridge doesn't send full instances
          edgeIds: []
        };
      });
    }

    return {
      graphs: graphs,
      activeGraphId: state.activeGraphId,
      graphCount: Object.keys(graphs).length,
      nodePrototypes: state.nodePrototypes,
      edges: state.edges,
      openGraphIds: state.openGraphIds,
      expandedGraphIds: state.expandedGraphIds,
      savedNodeIds: state.savedNodeIds,
      savedGraphIds: state.savedGraphIds
    };
  } catch (error) {
    console.error('Error in getGraphData:', error);
    return {
      graphs: {},
      activeGraphId: null,
      graphCount: 0,
      nodePrototypes: new Map(),
      edges: new Map(),
      openGraphIds: [],
      expandedGraphIds: new Set(),
      savedNodeIds: new Set(),
      savedGraphIds: new Set()
    };
  }
}



// Function to set up the bridge to the real Redstring store
function setupRedstringBridge(store) {
  redstringStoreBridge = store;
  console.error("✅ Redstring store bridge established");
}

// (The duplicate bridge, OAuth, /api/ai/agent and /api/ai/chat HTTP routes that
// used to live here were removed: the renderer, CLI and MCP tools talk to the
// agent server on BRIDGE_PORT, and nothing called these on the MCP port.)

/**
 * Run a registered MCP tool the way the SDK's stdio path does: validate the
 * arguments against the tool's zod schema first (never hand raw HTTP input to
 * a handler), then call its handler. Exported for tests via the HTTP route.
 */
async function callRegisteredTool(tool, toolName, rawArgs) {
  const handler = tool.handler || tool.callback;
  if (typeof handler !== 'function') throw new Error(`Tool ${toolName} has no handler`);
  if (!tool.inputSchema) return handler({});
  let args;
  if (typeof server.validateToolInput === 'function') {
    args = await server.validateToolInput(tool, rawArgs ?? {}, toolName);
  } else {
    const parsed = await tool.inputSchema.safeParseAsync(rawArgs ?? {});
    if (!parsed.success) {
      throw new Error(`Input validation error: Invalid arguments for tool ${toolName}: ${parsed.error.message}`);
    }
    args = parsed.data;
  }
  return handler(args, {});
}

// MCP request endpoint (direct handling since we ARE the MCP server).
// Only reachable when REDSTRING_MCP_HTTP=1, and only through the guard.
app.post('/api/mcp/request', async (req, res) => {
  try {
    const { method, params, id } = req.body || {};
    if (method === 'tools/call' && (!params || typeof params.name !== 'string')) {
      return res.status(400).json({ jsonrpc: '2.0', id, error: { code: -32602, message: 'params.name required' } });
    }
    const authHeader = req.headers.authorization;

    console.error('[MCP] Request received:', { method, id });

    let response;

    switch (method) {
      case 'initialize':
        response = {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: { listChanged: true } },
            serverInfo: {
              name: 'redstring',
              version: '1.0.0',
              capabilities: { resources: {}, tools: {} }
            }
          }
        };
        break;

      case 'tools/list':
        // Dynamically generate tool list from registered tools
        const registeredTools = server._registeredTools || {};
        const toolsList = Object.keys(registeredTools).map(name => {
          const tool = registeredTools[name];
          return {
            name: name,
            description: tool.description,
            // Fallback for schema since it's a Zod object
            inputSchema: { type: 'object', properties: {} }
          };
        });

        response = {
          jsonrpc: '2.0',
          id,
          result: {
            tools: toolsList
          }
        };
        break;

      case 'tools/call':
        const toolName = params.name;
        const toolArgs = params.arguments || {};

        console.error('[MCP] Tool call:', toolName, toolArgs);

        // Execute the tool directly since we have access to everything
        let toolResult;

        try {
          // Dynamic dispatch for ALL registered tools
          const registeredTools = server._registeredTools || {};
          const tool = registeredTools[toolName];

          if (tool) {
            console.error(`[MCP] Dynamic dispatch for: ${toolName}`);
            // For the chat tool, forward the caller's LLM key — but only when
            // the guard token came in X-Redstring-Token, so Authorization is
            // the LLM key and not our own token.
            if (toolName === 'chat' && authHeader && req.headers['x-redstring-token']) {
              toolArgs.authHeader = authHeader;
            }

            const result = await callRegisteredTool(tool, toolName, toolArgs);
            toolResult = result?.content?.[0]?.text || result;
          } else {
            // Fallback / helpful error
            const available = Object.keys(registeredTools);
            toolResult = `Tool "${toolName}" not found. Available tools: ${available.join(', ')}`;
          }
        } catch (error) {
          console.error(`[MCP] Tool ${toolName} error:`, error);

          // Provide more detailed error messages for chat tool
          if (toolName === 'chat') {
            let errorMessage = error.message;

            if (error.message.includes('Rate limit exceeded')) {
              errorMessage = 'Rate limit exceeded. Please wait a moment and try again, or try a different model.';
            } else if (error.message.includes('No endpoints found')) {
              errorMessage = 'Model not found on OpenRouter. Please check your model ID and try again.';
            } else if (error.message.includes('Invalid API key')) {
              errorMessage = 'Invalid API key. Please check your OpenRouter API key configuration.';
            } else if (error.message.includes('AI API call failed: 500')) {
              errorMessage = 'Server error. Please check your API key and model configuration, or try again later.';
            } else if (error.message.includes('AI API call failed: 404')) {
              errorMessage = 'Model not found. Please check your model ID and try again.';
            }

            toolResult = `I encountered an error: ${errorMessage}

**Troubleshooting:**
- Check your API key is valid
- Verify your model ID is correct (e.g., "anthropic/claude-3-sonnet")
- Try a different model if rate limited
- Make sure your OpenRouter account has credits`;
          } else {
            toolResult = `Error executing tool "${toolName}": ${error.message}`;
          }
        }

        response = {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{
              type: 'text',
              text: toolResult
            }]
          }
        };
        break;

      default:
        response = {
          jsonrpc: '2.0',
          id,
          error: {
            code: -32601,
            message: 'Method not found'
          }
        };
    }

    res.json(response);

  } catch (error) {
    console.error('[MCP] Request error:', error);
    res.status(500).json({
      jsonrpc: '2.0',
      id: req.body.id,
      error: {
        code: -32603,
        message: error.message
      }
    });
  }
});

// Main function
async function main() {
  await registerAllTools();

  // Add global error handlers to prevent crashes
  process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    // Don't exit the process, just log the error
  });

  process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    // Don't exit the process, just log the error
  });

  // CRITICAL: Connect stdio FIRST and AWAIT it.
  // stdin becomes an active event loop handle, preventing Node.js
  // from exiting even if the HTTP server fails to bind.
  try {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('ℹ️ MCP stdio initialized');
  } catch (e) {
    console.error('⚠️ MCP stdio failed:', e?.message || e);
  }

  // THEN, only if opted in, the HTTP listener (non-fatal if port is taken).
  // Placed AFTER stdio so the process stays alive regardless. Loopback only,
  // and every request passes the local-server guard.
  if (!MCP_HTTP_ENABLED) {
    console.error('ℹ️ MCP HTTP listener off (stdio only). Set REDSTRING_MCP_HTTP=1 to enable it.');
    global.setupRedstringBridge = setupRedstringBridge;
    return;
  }
  networkServer.listen(PORT, '127.0.0.1', () => {
    try {
      recordMcpHttpToken({ port: Number(PORT), token: MCP_HTTP_TOKEN });
      process.once('exit', () => { try { forgetMcpHttpToken({ port: Number(PORT) }); } catch { /* best effort */ } });
    } catch (err) {
      console.error('⚠️ Could not record MCP HTTP token in ~/.redstring/agent.json:', err?.message || err);
    }
    console.error(`MCP ${networkProtocol.toUpperCase()} listening on 127.0.0.1:${PORT} (token in ~/.redstring/agent.json under "mcp")`);
  });
  networkServer.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
      console.error(`⚠️ Port ${PORT} already in use. Continuing stdio-only.`);
    } else {
      console.error('⚠️ HTTP server error:', err?.message || err, '— continuing stdio-only.');
    }
  });

  // The bridge will be set up when Redstring connects
  global.setupRedstringBridge = setupRedstringBridge;
}

main().catch((error) => {
  console.error("Fatal error in MCP server:", error);
  process.exit(1);
}); 
