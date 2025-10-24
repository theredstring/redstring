#!/usr/bin/env node

/**
 * AI Connection Wizard for Redstring
 * 
 * This wizard automates the entire process of connecting Redstring to AI services:
 * - Detects available AI clients (Claude Desktop, Tome, etc.)
 * - Sets up MCP servers
 * - Configures bridges
 * - Validates connections
 * - Provides status monitoring with improved retry logic
 */

import { spawn } from 'child_process';
import { get, request } from 'http';
import https from 'https';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class AIConnectionWizard {
  constructor(options = {}) {
    this.options = { keepAlive: false, ...options };
    this.processes = new Map();
    this.status = {
      bridge: false,
      mcpServer: false,
      redstring: false,
      data: false,
      aiClient: null
    };
    this.config = {
      redstringPort: 4000,
      bridgePort: 3001,
      mcpServerPath: join(__dirname, 'redstring-mcp-server.js'),
      maxRetries: 5,
      retryDelay: 2000,
      startupTimeout: 10000
    };
    this.retryCounts = {
      bridge: 0,
      mcpServer: 0,
      data: 0
    };
    this.bridgeOrigin = this.options.bridgeUrl || `http://localhost:${this.config.bridgePort}`;
    if (!this.options.bridgeUrl && process.env.MCP_USE_HTTPS === 'true') {
      this.bridgeOrigin = `https://localhost:${this.config.bridgePort}`;
    }
    this.rejectUnauthorized = this.options.allowInsecure ? false : (this.options.rejectUnauthorized ?? true);
    if (process.env.MCP_TLS_REJECT_UNAUTHORIZED === 'false') {
      this.rejectUnauthorized = false;
    }
    this.options.hasCliAction = Boolean(
      this.options.hasCliAction ||
      this.options.summarize ||
      this.options.layoutReport ||
      this.options.layoutApply ||
      this.options.semanticImport
    );
    this.httpTimeoutMs = this.options.httpTimeout || 10000;
  }

  resolveBridgeUrl(pathname = '/') {
    try {
      const base = this.bridgeOrigin.endsWith('/') ? this.bridgeOrigin : `${this.bridgeOrigin}/`;
      return new URL(pathname, base);
    } catch (error) {
      const fallback = `http://localhost:${this.config.bridgePort}`;
      if (this.bridgeOrigin !== fallback) {
        console.warn(`⚠️  Invalid bridge URL "${this.bridgeOrigin}". Falling back to ${fallback}`);
      }
      this.bridgeOrigin = fallback;
      const base = `${fallback}/`;
      return new URL(pathname, base);
    }
  }

  async start() {
    console.log('🤖 AI Connection Wizard for Redstring');
    console.log('=====================================\n');

    try {
      // Step 1: Check if Redstring is running (non-fatal)
      try {
        await this.checkRedstringStatus();
      } catch (e) {
        console.log('⚠️  Proceeding without Redstring running on :4000 yet. You can start it anytime (npm run dev).');
        this.status.redstring = false;
      }
      
      // Step 2: Start MCP server (now includes HTTP functionality)
      await this.startMCPServerWithRetry();
      
      // Step 4: Detect AI clients
      await this.detectAIClients();
      
      // Step 5: Provide connection instructions
      await this.provideInstructions();

      if (this.options.hasCliAction) {
        await this.runCliTasks();
        if (!this.options.keepAlive) {
          this.cleanup();
          return;
        }
      }
      
      // Step 6: Start monitoring with improved retry logic (unless CLI one-shot)
      this.startMonitoring();
      
    } catch (error) {
      console.error('❌ Wizard failed:', error.message);
      this.cleanup();
      process.exit(1);
    }
  }

  async checkRedstringStatus() {
    console.log('🔍 Checking Redstring status...');
    
    return new Promise((resolve, reject) => {
      const request = get(`http://localhost:${this.config.redstringPort}`, (res) => {
        if (res.statusCode === 200) {
          console.log('✅ Redstring is running on localhost:4000');
          this.status.redstring = true;
          resolve();
        } else {
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      });
      
      request.on('error', (error) => {
        console.log('⚠️  Redstring not detected on localhost:4000');
        console.log('   Please start Redstring first: npm run dev');
        console.log('   Then run this wizard again.\n');
        reject(new Error('Redstring not running'));
      });
      
      request.setTimeout(5000, () => {
        request.destroy();
        reject(new Error('Redstring connection timeout'));
      });
    });
  }

  // Bridge server methods removed - functionality consolidated into MCP server



  async startMCPServerWithRetry() {
    console.log('🔌 Starting MCP server...');
    
    // If an MCP server is already running on the expected port, reuse it
    const existing = await this._pingHealthOnce();
    if (existing) {
      console.log(`✅ MCP server already running on ${this.bridgeOrigin}`);
      this.status.mcpServer = true;
      return;
    }

    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      try {
        await this.startMCPServer();
        console.log(`✅ MCP server started successfully (attempt ${attempt})`);
        return;
      } catch (error) {
        console.log(`   Attempt ${attempt}/${this.config.maxRetries} failed: ${error.message}`);
        
        if (attempt < this.config.maxRetries) {
          console.log(`   Waiting ${this.config.retryDelay}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, this.config.retryDelay));
          
          // Kill any existing MCP processes before retry
          this.killProcess('mcp');
        } else {
          throw new Error(`MCP server failed to start after ${this.config.maxRetries} attempts`);
        }
      }
    }
  }

  async startMCPServer() {
    return new Promise((resolve, reject) => {
      const mcpProcess = spawn('node', [this.config.mcpServerPath], {
        cwd: __dirname,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, NODE_ENV: 'production' }
      });
      
      // Share the MCP process globally for potential future use
      global.mcpProcess = mcpProcess;

      let startupTimeout = setTimeout(() => {
        if (!this.status.mcpServer) {
          mcpProcess.kill();
          reject(new Error('MCP server startup timeout'));
        }
      }, this.config.startupTimeout);

      let stderrBuffer = '';

      // Check if MCP server is actually responding to health checks
      const checkMCPHealth = () => {
        this.httpRequest('GET', '/health')
          .then(() => {
            if (this.status.mcpServer) return;
            clearTimeout(startupTimeout);
            console.log('✅ MCP server started');
            this.status.mcpServer = true;
            this.processes.set('mcp', mcpProcess);
            resolve();
          })
          .catch(() => {
            if (!this.status.mcpServer) {
              setTimeout(checkMCPHealth, 500);
            }
          });
      };

      // Start checking after a short delay to let the server initialize
      setTimeout(checkMCPHealth, 2000);

      mcpProcess.stdout.on('data', (data) => {
        const output = data.toString();
        console.log('MCP:', output.trim());
      });

      mcpProcess.stderr.on('data', (data) => {
        const error = data.toString();
        stderrBuffer += error;
        if (error.includes('Waiting for Redstring store bridge')) {
          clearTimeout(startupTimeout);
          console.log('✅ MCP server started (waiting for bridge)');
          this.status.mcpServer = true;
          this.processes.set('mcp', mcpProcess);
          resolve();
        } else if (error.includes('EADDRINUSE')) {
          // Port in use: treat as already running and proceed
          clearTimeout(startupTimeout);
          console.log('⚠️  Port 3001 already in use. Assuming MCP server is already running.');
          this.status.mcpServer = true;
          this.processes.set('mcp', mcpProcess);
          resolve();
        } else {
          console.error('MCP stderr:', error.trim());
        }
      });

      mcpProcess.on('error', (error) => {
        clearTimeout(startupTimeout);
        console.error('❌ Failed to start MCP server:', error.message);
        reject(error);
      });

      mcpProcess.on('exit', (code) => {
        if (code !== 0 && !this.status.mcpServer) {
          clearTimeout(startupTimeout);
          if (stderrBuffer.trim()) {
            console.error('MCP stderr before exit:\n' + stderrBuffer.trim());
          }
          reject(new Error(`MCP server exited with code ${code}`));
        }
      });
    });
  }

  _pingHealthOnce() {
    return this.httpRequest('GET', '/health')
      .then(() => true)
      .catch(() => false);
  }

  async detectAIClients() {
    console.log('🔍 Detecting AI clients...');
    
    const clients = [];
    
    // Check for Claude Desktop
    const claudeConfigPath = join(process.env.HOME, 'Library/Application Support/Claude/claude_desktop_config.json');
    if (existsSync(claudeConfigPath)) {
      try {
        const config = JSON.parse(readFileSync(claudeConfigPath, 'utf8'));
        if (config.mcpServers?.redstring) {
          clients.push({
            name: 'Claude Desktop',
            type: 'claude',
            config: config.mcpServers.redstring,
            status: 'configured'
          });
        } else {
          clients.push({
            name: 'Claude Desktop',
            type: 'claude',
            status: 'not_configured'
          });
        }
      } catch (error) {
        clients.push({
          name: 'Claude Desktop',
          type: 'claude',
          status: 'error'
        });
      }
    }

    // Check for Tome
    const tomeConfigPath = join(process.env.HOME, 'Library/Application Support/Tome');
    if (existsSync(tomeConfigPath)) {
      clients.push({
        name: 'Tome',
        type: 'tome',
        status: 'available'
      });
    }

    // Check for other MCP clients
    const mcpLogPath = join(process.env.HOME, 'Library/Logs/Claude/mcp.log');
    if (existsSync(mcpLogPath)) {
      clients.push({
        name: 'Other MCP Client',
        type: 'generic',
        status: 'available'
      });
    }

    this.status.aiClient = clients[0] || null;
    
    if (clients.length > 0) {
      console.log('✅ Detected AI clients:');
      clients.forEach(client => {
        console.log(`   - ${client.name} (${client.status})`);
      });
    } else {
      console.log('⚠️  No AI clients detected');
    }
  }

  async provideInstructions() {
    console.log('\n📋 Connection Instructions:');
    console.log('==========================\n');

    if (this.status.aiClient?.type === 'claude' && this.status.aiClient.status === 'configured') {
      console.log('🎉 Claude Desktop is already configured!');
      console.log('   Just restart Claude Desktop to connect.');
    } else if (this.status.aiClient?.type === 'claude') {
      console.log('🔧 To configure Claude Desktop:');
      console.log('   1. Open Claude Desktop');
      console.log('   2. Go to Settings > Local MCP Servers');
      console.log('   3. Add new server:');
      console.log(`      Command: node`);
      console.log(`      Args: ${this.config.mcpServerPath}`);
      console.log('   4. Restart Claude Desktop');
    }

    if (this.status.aiClient?.type === 'tome') {
      console.log('🔧 To configure Tome:');
      console.log('   1. Open Tome');
      console.log('   2. Go to Settings > MCP Servers');
      console.log('   3. Add new server:');
      console.log(`      Command: node ${this.config.mcpServerPath}`);
      console.log('   4. Test the connection');
    }

    console.log('\n🔗 Available MCP Tools:');
    console.log('   - verify_state');
    console.log('   - get_graph_instances');
    console.log('   - list_available_graphs');
    console.log('   - get_active_graph');
    console.log('   - open_graph');
    console.log('   - set_active_graph');
    console.log('   - addNodeToGraph (RECOMMENDED)');
    console.log('   - removeNodeFromGraph (RECOMMENDED)');
    console.log('   - add_node_prototype (LEGACY)');
    console.log('   - add_node_instance (LEGACY)');
  }

  async httpRequest(method, path, payload) {
    const url = this.resolveBridgeUrl(path);
    const isHttps = url.protocol === 'https:';
    const options = {
      method,
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      headers: { Accept: 'application/json' },
      timeout: this.httpTimeoutMs
    };

    if (isHttps) {
      options.rejectUnauthorized = this.rejectUnauthorized;
    }

    let body = null;
    if (payload !== undefined && payload !== null) {
      body = JSON.stringify(payload);
      options.headers['Content-Type'] = 'application/json';
      options.headers['Content-Length'] = Buffer.byteLength(body);
    }

    return new Promise((resolve, reject) => {
      const req = (isHttps ? https.request : request)(options, (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            return reject(new Error(`HTTP ${res.statusCode}: ${data || res.statusMessage}`));
          }
          if (!data) return resolve(null);
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve(data);
          }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy(new Error(`Request to ${url.href} timed out after ${this.httpTimeoutMs}ms`));
      });
      if (body) {
        req.write(body);
      }
      req.end();
    });
  }

  async fetchBridgeState() {
    try {
      return await this.httpRequest('GET', '/api/bridge/state');
    } catch (error) {
      console.error('❌ Failed to fetch bridge state:', error.message);
      return null;
    }
  }

  async postJson(path, payload) {
    return this.httpRequest('POST', path, payload);
  }

  printGraphSummaries(state) {
    const summaries = state?.graphSummaries;
    if (!summaries || Object.keys(summaries).length === 0) {
      console.log('\nℹ️  No graph summaries available yet. Update the UI bridge to send graphLayouts/graphSummaries.');
      return;
    }

    console.log('\n🧠 Graph Summaries');
    Object.values(summaries).forEach((summary) => {
      console.log(`\n- ${summary.name} (${summary.id})`);
      console.log(`  Nodes: ${summary.nodeCount} | Edges: ${summary.edgeCount} | Density: ${summary.density ?? 'n/a'} | Quality: ${summary.quality ?? 'unknown'} | Score: ${summary.score ?? 'n/a'}`);
      if (summary.text) {
        const trimmed = summary.text.split('\n').slice(0, 40); // keep it readable
        trimmed.forEach(line => console.log(`    ${line}`));
        if (summary.text.split('\n').length > trimmed.length) {
          console.log('    ... (truncated)');
        }
      }
    });
  }

  computeLayoutPlan(state, strategy = 'normalize') {
    const layouts = state?.graphLayouts || {};
    const plan = {};
    const strategyName = strategy.toLowerCase();

    Object.entries(layouts).forEach(([graphId, layout]) => {
      if (!layout || typeof layout !== 'object') return;
      const nodes = layout.nodes || {};
      const entries = Object.entries(nodes);
      if (entries.length === 0) return;

      if (strategyName === 'grid') {
        const spacing = Number(this.options.gridSpacing) || 200;
        const total = entries.length;
        const columns = Math.max(1, Math.ceil(Math.sqrt(total)));
        const rows = Math.max(1, Math.ceil(total / columns));
        const width = (columns - 1) * spacing;
        const height = (rows - 1) * spacing;
        const offsetX = width / 2;
        const offsetY = height / 2;

        const ordered = [...entries].sort((a, b) => {
          const protoA = a[1]?.prototypeId || '';
          const protoB = b[1]?.prototypeId || '';
          if (protoA === protoB) return a[0].localeCompare(b[0]);
          return protoA.localeCompare(protoB);
        });

        const nextNodes = {};
        ordered.forEach(([nodeId, node], index) => {
          const row = Math.floor(index / columns);
          const col = index % columns;
          const x = (col * spacing) - offsetX;
          const y = (row * spacing) - offsetY;
          nextNodes[nodeId] = {
            x: Math.round(x),
            y: Math.round(y),
            scale: node?.scale ?? 1
          };
        });

        plan[graphId] = {
          nodes: nextNodes,
          metadata: {
            strategy: 'grid',
            spacing,
            columns,
            rows,
            nodeCount: entries.length,
            computedAt: Date.now()
          }
        };
        return;
      }

      const centroid = layout?.metadata?.centroid;
      let cx = centroid?.x ?? 0;
      let cy = centroid?.y ?? 0;
      if (!centroid) {
        entries.forEach(([, node]) => {
          cx += node?.x || 0;
          cy += node?.y || 0;
        });
        cx = cx / entries.length;
        cy = cy / entries.length;
      }

      const normalizedNodes = {};
      entries.forEach(([nodeId, node]) => {
        const nx = Math.round((node?.x || 0) - cx);
        const ny = Math.round((node?.y || 0) - cy);
        normalizedNodes[nodeId] = {
          x: nx,
          y: ny,
          scale: node?.scale ?? 1
        };
      });

      plan[graphId] = {
        nodes: normalizedNodes,
        metadata: {
          strategy: 'normalize',
          appliedOffset: { x: Math.round(-cx), y: Math.round(-cy) },
          nodeCount: entries.length,
          computedAt: Date.now(),
          sourceBoundingBox: layout?.metadata?.boundingBox || null
        }
      };
    });

    return plan;
  }

  printLayoutPlan(plan, state) {
    const entries = Object.entries(plan || {});
    if (entries.length === 0) {
      console.log('\n🧭 Layout: no adjustments suggested.');
      return;
    }

    console.log('\n🧭 Layout Suggestions');
    const summaries = state?.graphSummaries || {};
    entries.forEach(([graphId, layout]) => {
      const name = summaries[graphId]?.name || graphId;
      const meta = layout.metadata || {};
      console.log(`- ${name} (${graphId})`);
      console.log(`    Strategy: ${meta.strategy || 'custom'} | Nodes: ${meta.nodeCount || 0}`);
      if (meta.appliedOffset) {
        console.log(`    Offset applied: Δx=${meta.appliedOffset.x}, Δy=${meta.appliedOffset.y}`);
      }
      if (meta.spacing) {
        console.log(`    Grid: ${meta.columns} × ${meta.rows}, spacing ${meta.spacing}px`);
      }
      if (meta.sourceBoundingBox) {
        const bbox = meta.sourceBoundingBox;
        console.log(`    Previous bounds: x[${bbox.minX}, ${bbox.maxX}] y[${bbox.minY}, ${bbox.maxY}]`);
      }
    });
  }

  async applyLayoutPlan(plan, mode = 'merge') {
    const graphCount = Object.keys(plan || {}).length;
    if (!graphCount) {
      console.log('ℹ️  No layout changes to apply.');
      return;
    }
    try {
      await this.postJson('/api/bridge/layout', { layouts: plan, mode });
      console.log(`✅ Applied layout updates for ${graphCount} graph${graphCount === 1 ? '' : 's'}.`);
    } catch (error) {
      console.error('❌ Failed to write layout metadata:', error.message);
    }
  }

  async runSemanticImport(state) {
    console.log('\n🌐 Semantic Web import:');
    console.log('   This wizard now exposes graph summaries/layouts so external agents can grade or augment the workspace.');
    console.log('   Hook your semantic ingestion scripts to /api/bridge/state, enrich the graph, and repost via /api/bridge/layout or pending actions.');
    console.log('   (Automated semantic import is not bundled yet; contribute your loader via scripts/semantic-import.js).');
  }

  async runCliTasks() {
    const state = await this.fetchBridgeState();
    if (!state) {
      console.log('❌ Unable to read bridge state; CLI tasks skipped.');
      return;
    }

    if (this.options.summarize) {
      this.printGraphSummaries(state);
    }

    if (this.options.layoutReport || this.options.layoutApply) {
      const plan = this.computeLayoutPlan(state, this.options.layoutStrategy || 'normalize');
      this.printLayoutPlan(plan, state);
      if (this.options.layoutApply) {
        await this.applyLayoutPlan(plan, this.options.layoutMode || 'merge');
      }
    }

    if (this.options.semanticImport) {
      await this.runSemanticImport(state);
    }
  }

  startMonitoring() {
    console.log('\n📊 Starting connection monitor...');
    console.log('   Press Ctrl+C to stop the wizard\n');

    let consecutiveFailures = 0;
    const maxFailures = 5; // Increased tolerance
    const timeout = 8000; // 8 second timeout
    let lastStatus = { mcp: false, redstring: false, data: false };
    let isFirstCheck = true;

    // Give servers time to start up before first check
    setTimeout(() => {
      const monitor = setInterval(async () => {
        try {
          const currentStatus = await this.checkAllServices();
          
          // Update status display
          this.updateStatusDisplay(currentStatus);
          
          // Check for changes that require reconnection
          if (this.hasServiceChanged(lastStatus, currentStatus)) {
            console.log('\n🔄 Service status changed, checking connections...');
            
            // Only count failures for core services, data can be temporarily unavailable
            if (!currentStatus.mcp || !currentStatus.redstring) {
              consecutiveFailures++;
              if (consecutiveFailures >= maxFailures) {
                console.log('\n⚠️  Connection issues detected! Attempting to reconnect...');
                await this.attemptReconnection();
                consecutiveFailures = 0; // Reset after reconnection attempt
              }
            } else {
              consecutiveFailures = 0; // Reset on success
            }
          }
          
          // Always reset failure count if both core services are working
          if (currentStatus.mcp && currentStatus.redstring) {
            consecutiveFailures = 0;
          }
          
          lastStatus = currentStatus;
        
        } catch (error) {
          consecutiveFailures++;
          process.stdout.write('\r');
          process.stdout.write(`Status: MCP ❌ | Redstring ❌ | Data ❌ (Error: ${error.message})`);
          
          if (consecutiveFailures >= maxFailures) {
            console.log('\n\n⚠️  Connection lost! Attempting to reconnect...');
            this.attemptReconnection();
            consecutiveFailures = 0;
          }
        }
      }, timeout); // Check every 8 seconds

      // Handle cleanup on exit
      process.on('SIGINT', () => {
        console.log('\n\n🛑 Shutting down AI Connection Wizard...');
        clearInterval(monitor);
        this.cleanup();
        process.exit(0);
      });

      process.on('SIGTERM', () => {
        console.log('\n\n🛑 Shutting down AI Connection Wizard...');
        clearInterval(monitor);
        this.cleanup();
        process.exit(0);
      });
    }, 3000); // Wait 3 seconds before starting monitoring
  }

  async checkAllServices() {
    const status = { mcp: false, redstring: false, data: false };
    
    // Check MCP server status (now includes HTTP functionality)
    try {
      const mcpData = await this.checkMCPStatus();
      status.mcp = true;
      status.data = mcpData.hasData;
      status.redstring = mcpData.hasRecentData;
    } catch (error) {
      // MCP failed, try direct Redstring check
      try {
        await this.checkRedstringDirect();
        status.redstring = true;
      } catch (redstringError) {
        // Both failed
      }
    }
    
    return status;
  }

  async checkMCPStatus() {
    try {
      await this.httpRequest('GET', '/health');
    } catch (error) {
      throw new Error('MCP server not responding');
    }

    try {
      const bridgeData = await this.httpRequest('GET', '/api/bridge/state');
      const hasData = bridgeData?.graphs?.length > 0;
      const hasRecentData = Boolean(
        bridgeData?.summary?.lastUpdate &&
        (Date.now() - bridgeData.summary.lastUpdate) < 30000
      );
      return { hasData, hasRecentData };
    } catch (error) {
      // MCP server up but bridge payload not ready yet
      return { hasData: false, hasRecentData: false };
    }
  }

  async checkRedstringDirect() {
    return new Promise((resolve, reject) => {
      const request = get(`http://localhost:${this.config.redstringPort}`, (res) => {
        resolve();
      });
      
      request.on('error', () => {
        reject(new Error('Redstring connection failed'));
      });
      
      request.setTimeout(2000, () => {
        request.destroy();
        reject(new Error('Redstring timeout'));
      });
    });
  }

  updateStatusDisplay(status) {
    process.stdout.write('\r');
    process.stdout.write(`Status: MCP ${status.mcp ? 'OK' : 'FAIL'} | Redstring ${status.redstring ? 'OK' : 'FAIL'} | Data ${status.data ? 'OK' : 'FAIL'}`);
  }

  hasServiceChanged(lastStatus, currentStatus) {
    return lastStatus.mcp !== currentStatus.mcp ||
           lastStatus.redstring !== currentStatus.redstring ||
           lastStatus.data !== currentStatus.data;
  }

  async attemptReconnection() {
    console.log('🔄 Attempting to reconnect...');
    
    try {
      // Wait a moment before attempting reconnection
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Check current status
      const currentStatus = await this.checkAllServices();
      
      if (currentStatus.mcp && currentStatus.redstring) {
        console.log('✅ Reconnection successful! Services are back online.');
        return;
      }
      
      // Try to restart MCP server if it's down
      if (!currentStatus.mcp) {
        console.log('🔄 MCP server down, attempting to restart...');
        try {
          await this.startMCPServerWithRetry();
          console.log('✅ MCP server restarted successfully');
        } catch (error) {
          console.log('❌ Failed to restart MCP server:', error.message);
        }
      }
      
      // Check if Redstring is down
      if (!currentStatus.redstring) {
        console.log('⚠️  Redstring appears to be down. Please restart it manually.');
        console.log('   Run: npm run dev');
      }
      
      // Wait a bit and check again
      await new Promise(resolve => setTimeout(resolve, 3000));
      const finalStatus = await this.checkAllServices();
      
      if (finalStatus.mcp && finalStatus.redstring) {
        console.log('✅ Reconnection completed successfully!');
      } else {
        console.log('⚠️  Some services still unavailable. Manual intervention may be needed.');
      }
      
    } catch (error) {
      console.log('❌ Reconnection attempt failed:', error.message);
    }
  }

  killProcess(name) {
    const process = this.processes.get(name);
    if (process) {
      try {
        process.kill();
        this.processes.delete(name);
        console.log(`   Killed ${name} process`);
      } catch (error) {
        // Process might already be dead
      }
    }
  }

  cleanup() {
    console.log('🧹 Cleaning up processes...');
    
    for (const [name, process] of this.processes) {
      try {
        process.kill();
        console.log(`   Stopped ${name} process`);
      } catch (error) {
        // Process might already be dead
      }
    }
    
    this.processes.clear();
  }
}

const parseCliOptions = () => {
  const args = process.argv.slice(2);
  const options = { keepAlive: false };

  args.forEach((arg) => {
    if (arg === '--summarize' || arg === '-s') {
      options.summarize = true;
    } else if (arg === '--layout-report') {
      options.layoutReport = true;
    } else if (arg === '--apply-layout') {
      options.layoutApply = true;
    } else if (arg.startsWith('--layout-strategy=')) {
      options.layoutStrategy = arg.split('=')[1];
    } else if (arg.startsWith('--layout-mode=')) {
      options.layoutMode = arg.split('=')[1];
    } else if (arg.startsWith('--grid-spacing=')) {
      const value = Number(arg.split('=')[1]);
      if (!Number.isNaN(value)) options.gridSpacing = value;
    } else if (arg === '--semantic-import') {
      options.semanticImport = true;
    } else if (arg === '--watch') {
      options.keepAlive = true;
    } else if (arg === '--allow-insecure') {
      options.allowInsecure = true;
    } else if (arg.startsWith('--bridge-url=')) {
      options.bridgeUrl = arg.split('=')[1];
    } else if (arg.startsWith('--http-timeout=')) {
      const value = Number(arg.split('=')[1]);
      if (!Number.isNaN(value)) options.httpTimeout = value;
    }
  });

  options.hasCliAction = Boolean(options.summarize || options.layoutReport || options.layoutApply || options.semanticImport);
  return options;
};

const cliOptions = parseCliOptions();
const wizard = new AIConnectionWizard(cliOptions);

wizard.start()
  .then(() => {
    if (cliOptions.hasCliAction && !cliOptions.keepAlive) {
      process.exit(0);
    }
  })
  .catch(error => {
    console.error('❌ Wizard failed:', error.message);
    process.exit(1);
  });
