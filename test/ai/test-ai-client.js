#!/usr/bin/env node

/**
 * AI Client Simulator for Redstring MCP Server
 * 
 * This script simulates what an AI client (like Claude Desktop) would do:
 * - Connects to the MCP server
 * - Lists available tools
 * - Calls various Redstring operations
 * - Demonstrates the full workflow
 */

import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class AIClientSimulator {
  constructor() {
    this.mcpProcess = null;
    this.requestId = 1;
    this.tools = [];
  }

  async start() {
    console.log('🤖 AI Client Simulator for Redstring');
    console.log('=====================================\n');

    try {
      // Start the MCP server
      await this.startMCPServer();
      
      // Wait for MCP server to connect to bridge
      console.log('⏳ Waiting for MCP server to connect to bridge...');
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Initialize the connection
      await this.initialize();
      
      // List available tools
      await this.listTools();
      
      // Demonstrate various operations
      await this.demonstrateOperations();
      
      // Cleanup
      this.cleanup();
      
    } catch (error) {
      console.error('❌ AI Client Simulator failed:', error.message);
      this.cleanup();
      process.exit(1);
    }
  }

  async startMCPServer() {
    console.log('🔌 Starting MCP server...');
    
    return new Promise((resolve, reject) => {
      this.mcpProcess = spawn('node', [join(__dirname, 'redstring-mcp-server.js')], {
        cwd: __dirname,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let startupTimeout = setTimeout(() => {
        reject(new Error('MCP server startup timeout'));
      }, 10000);

      this.mcpProcess.stdout.on('data', (data) => {
        const output = data.toString();
        console.log('MCP stdout:', output.trim());
        if (output.includes('Redstring MCP Server running')) {
          clearTimeout(startupTimeout);
          console.log('✅ MCP server started');
          resolve();
        }
      });

      this.mcpProcess.stderr.on('data', (data) => {
        const error = data.toString();
        console.log('MCP stderr:', error.trim());
        if (error.includes('Waiting for Redstring store bridge')) {
          clearTimeout(startupTimeout);
          console.log('✅ MCP server started (waiting for bridge)');
          resolve();
        }
      });

      this.mcpProcess.on('error', (error) => {
        clearTimeout(startupTimeout);
        reject(error);
      });
    });
  }

  async initialize() {
    console.log('🤝 Initializing MCP connection...');
    
    // Send initialize request
    const initRequest = {
      jsonrpc: '2.0',
      id: this.requestId++,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {}
        },
        clientInfo: {
          name: 'AI Client Simulator',
          version: '1.0.0'
        }
      }
    };

    await this.sendRequest(initRequest);
    console.log('✅ MCP connection initialized');
  }

  async listTools() {
    console.log('\n🔧 Listing available tools...');
    
    const listRequest = {
      jsonrpc: '2.0',
      id: this.requestId++,
      method: 'tools/list',
      params: {}
    };

    const response = await this.sendRequest(listRequest);
    
    if (response.result && response.result.tools) {
      this.tools = response.result.tools;
      console.log(`✅ Found ${this.tools.length} tools:`);
      this.tools.forEach(tool => {
        console.log(`   - ${tool.name}: ${tool.description}`);
      });
    } else {
      console.log('⚠️  No tools found or invalid response');
    }
  }

  async demonstrateOperations() {
    console.log('\n🎯 Demonstrating Redstring operations...\n');

    // 1. Verify state
    await this.callTool('verify_state', {});

    // 2. List available graphs
    await this.callTool('list_available_graphs', {});

    // 3. Get active graph
    await this.callTool('get_active_graph', {});

    // 4. Get graph instances
    await this.callTool('get_graph_instances', {});

    // 5. Try to add a node (if we have a graph)
    await this.demonstrateNodeOperations();
  }

  async demonstrateNodeOperations() {
    console.log('\n📝 Demonstrating node operations...\n');

    // First, let's see what graphs are available
    const graphsResponse = await this.callTool('list_available_graphs', {});
    
    if (graphsResponse.result && graphsResponse.result.graphs && graphsResponse.result.graphs.length > 0) {
      const graphId = graphsResponse.result.graphs[0].id;
      console.log(`📊 Using graph: ${graphId}`);

      // Try to add a node to this graph
      const addNodeResponse = await this.callTool('addNodeToGraph', {
        graphId: graphId,
        nodeData: {
          name: 'Test Node from AI',
          description: 'This node was created by the AI client simulator',
          position: { x: 100, y: 100 },
          type: 'note'
        }
      });

      if (addNodeResponse.result) {
        console.log('✅ Successfully added node to graph');
        
        // Try to remove the node we just added
        if (addNodeResponse.result.nodeId) {
          const removeNodeResponse = await this.callTool('removeNodeFromGraph', {
            graphId: graphId,
            nodeId: addNodeResponse.result.nodeId
          });

          if (removeNodeResponse.result) {
            console.log('✅ Successfully removed node from graph');
          }
        }
      }
    } else {
      console.log('⚠️  No graphs available for node operations');
    }
  }

  async callTool(toolName, params) {
    console.log(`🔧 Calling tool: ${toolName}`);
    
    const toolRequest = {
      jsonrpc: '2.0',
      id: this.requestId++,
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: params
      }
    };

    try {
      const response = await this.sendRequest(toolRequest);
      
      if (response.result) {
        console.log(`✅ ${toolName} succeeded:`, JSON.stringify(response.result, null, 2));
      } else if (response.error) {
        console.log(`❌ ${toolName} failed:`, response.error.message);
      }
      
      return response;
    } catch (error) {
      console.log(`❌ ${toolName} error:`, error.message);
      return { error: error.message };
    }
  }

  async sendRequest(request) {
    return new Promise((resolve, reject) => {
      const requestStr = JSON.stringify(request) + '\n';
      
      this.mcpProcess.stdin.write(requestStr);
      
      // Set up response handler
      const responseHandler = (data) => {
        const lines = data.toString().split('\n');
        for (const line of lines) {
          if (line.trim()) {
            try {
              const response = JSON.parse(line);
              if (response.id === request.id) {
                this.mcpProcess.stdout.removeListener('data', responseHandler);
                resolve(response);
                return;
              }
            } catch (error) {
              // Ignore parsing errors for non-JSON output
            }
          }
        }
      };
      
      this.mcpProcess.stdout.on('data', responseHandler);
      
      // Timeout after 10 seconds
      setTimeout(() => {
        this.mcpProcess.stdout.removeListener('data', responseHandler);
        reject(new Error('Request timeout'));
      }, 10000);
    });
  }

  cleanup() {
    console.log('\n🧹 Cleaning up...');
    if (this.mcpProcess) {
      this.mcpProcess.kill();
      console.log('✅ MCP server stopped');
    }
  }
}

// Start the simulator
const simulator = new AIClientSimulator();
simulator.start().catch(error => {
  console.error('❌ Simulator failed:', error.message);
  process.exit(1);
}); 