#!/usr/bin/env node

/**
 * Simple AI Client Test for Redstring MCP Server
 * 
 * This script tests a single MCP tool call to verify the connection works.
 */

import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class SimpleAIClientTest {
  constructor() {
    this.mcpProcess = null;
    this.requestId = 1;
  }

  async start() {
    console.log('🤖 Simple AI Client Test for Redstring');
    console.log('=====================================\n');

    try {
      // Start the MCP server
      await this.startMCPServer();
      
      // Wait for connection
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Initialize the connection
      await this.initialize();
      
      // Test a simple tool call
      await this.testSimpleTool();
      
      // Cleanup
      this.cleanup();
      
    } catch (error) {
      console.error('❌ Test failed:', error.message);
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

      this.mcpProcess.stderr.on('data', (data) => {
        const error = data.toString();
        if (error.includes('Redstring MCP Server running')) {
          clearTimeout(startupTimeout);
          console.log('✅ MCP server started');
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
          name: 'Simple AI Client Test',
          version: '1.0.0'
        }
      }
    };

    await this.sendRequest(initRequest);
    console.log('✅ MCP connection initialized');
  }

  async testSimpleTool() {
    console.log('\n🔧 Testing simple tool call...');
    
    // Test verify_state tool
    const response = await this.callTool('verify_state', {});
    
    if (response.result) {
      console.log('✅ Tool call successful!');
      console.log('Result:', JSON.stringify(response.result, null, 2));
    } else if (response.error) {
      console.log('❌ Tool call failed:', response.error.message);
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

// Start the test
const test = new SimpleAIClientTest();
test.start().catch(error => {
  console.error('❌ Test failed:', error.message);
  process.exit(1);
}); 