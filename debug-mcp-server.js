#!/usr/bin/env node

/**
 * MCP Server Debug Tool
 * 
 * This script provides detailed debugging information for the MCP server connection.
 */

import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class MCPServerDebugger {
  constructor() {
    this.mcpProcess = null;
    this.requestId = 1;
    this.debugLog = [];
  }

  async start() {
    console.log('🔍 MCP Server Debug Tool');
    console.log('=======================\n');

    try {
      // Start the MCP server with full debugging
      await this.startMCPServerWithDebug();
      
      // Wait for connection
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Test with detailed logging
      await this.testWithDetailedLogging();
      
      // Show debug summary
      this.showDebugSummary();
      
      // Cleanup
      this.cleanup();
      
    } catch (error) {
      console.error('❌ Debug failed:', error.message);
      this.cleanup();
      process.exit(1);
    }
  }

  async startMCPServerWithDebug() {
    console.log('🔌 Starting MCP server with full debugging...');
    
    return new Promise((resolve, reject) => {
      this.mcpProcess = spawn('node', [join(__dirname, 'redstring-mcp-server.js')], {
        cwd: __dirname,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let startupTimeout = setTimeout(() => {
        reject(new Error('MCP server startup timeout'));
      }, 10000);

      // Log ALL stdout data
      this.mcpProcess.stdout.on('data', (data) => {
        const output = data.toString();
        console.log('📤 MCP STDOUT:', output.trim());
        this.debugLog.push({ type: 'stdout', data: output, timestamp: Date.now() });
      });

      // Log ALL stderr data
      this.mcpProcess.stderr.on('data', (data) => {
        const error = data.toString();
        console.log('📤 MCP STDERR:', error.trim());
        this.debugLog.push({ type: 'stderr', data: error, timestamp: Date.now() });
      });

      // Log process events
      this.mcpProcess.on('error', (error) => {
        console.log('❌ MCP PROCESS ERROR:', error.message);
        this.debugLog.push({ type: 'process_error', data: error.message, timestamp: Date.now() });
        clearTimeout(startupTimeout);
        reject(error);
      });

      this.mcpProcess.on('exit', (code, signal) => {
        console.log(`📤 MCP PROCESS EXIT: code=${code}, signal=${signal}`);
        this.debugLog.push({ type: 'process_exit', data: { code, signal }, timestamp: Date.now() });
      });

      // Wait for server to start
      setTimeout(() => {
        clearTimeout(startupTimeout);
        console.log('✅ MCP server started (debug mode)');
        resolve();
      }, 2000);
    });
  }

  async testWithDetailedLogging() {
    console.log('\n🧪 Testing with detailed logging...\n');

    // Test 1: Initialize connection
    await this.testInitializeWithDebug();

    // Test 2: List tools with debug
    await this.testListToolsWithDebug();

    // Test 3: Test a simple tool with debug
    await this.testSimpleToolWithDebug();
  }

  async testInitializeWithDebug() {
    console.log('🔧 Testing: Initialize MCP connection');
    
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
          name: 'MCP Debug Tool',
          version: '1.0.0'
        }
      }
    };

    console.log('📤 Sending initialize request:', JSON.stringify(initRequest, null, 2));
    
    try {
      const response = await this.sendRequestWithDebug(initRequest, 'initialize');
      console.log('📥 Initialize response:', JSON.stringify(response, null, 2));
      
      if (response.result) {
        console.log('✅ Initialize succeeded');
      } else if (response.error) {
        console.log('❌ Initialize failed:', response.error);
      }
    } catch (error) {
      console.log('❌ Initialize error:', error.message);
    }
  }

  async testListToolsWithDebug() {
    console.log('\n🔧 Testing: List tools');
    
    const listRequest = {
      jsonrpc: '2.0',
      id: this.requestId++,
      method: 'tools/list',
      params: {}
    };

    console.log('📤 Sending tools/list request:', JSON.stringify(listRequest, null, 2));
    
    try {
      const response = await this.sendRequestWithDebug(listRequest, 'tools/list');
      console.log('📥 Tools/list response:', JSON.stringify(response, null, 2));
      
      if (response.result && response.result.tools) {
        console.log(`✅ Found ${response.result.tools.length} tools`);
        response.result.tools.slice(0, 3).forEach((tool, index) => {
          console.log(`   ${index + 1}. ${tool.name}: ${tool.description.substring(0, 50)}...`);
        });
        if (response.result.tools.length > 3) {
          console.log(`   ... and ${response.result.tools.length - 3} more`);
        }
      } else if (response.error) {
        console.log('❌ Tools/list failed:', response.error);
      }
    } catch (error) {
      console.log('❌ Tools/list error:', error.message);
    }
  }

  async testSimpleToolWithDebug() {
    console.log('\n🔧 Testing: Simple tool call (verify_state)');
    
    const toolRequest = {
      jsonrpc: '2.0',
      id: this.requestId++,
      method: 'tools/call',
      params: {
        name: 'verify_state',
        arguments: {}
      }
    };

    console.log('📤 Sending verify_state request:', JSON.stringify(toolRequest, null, 2));
    
    try {
      const response = await this.sendRequestWithDebug(toolRequest, 'verify_state');
      console.log('📥 Verify_state response:', JSON.stringify(response, null, 2));
      
      if (response.result) {
        console.log('✅ Verify_state succeeded');
        if (response.result.content && response.result.content[0]) {
          console.log('📄 Response content preview:', response.result.content[0].text.substring(0, 200) + '...');
        }
      } else if (response.error) {
        console.log('❌ Verify_state failed:', response.error);
      }
    } catch (error) {
      console.log('❌ Verify_state error:', error.message);
    }
  }

  async sendRequestWithDebug(request, requestType) {
    return new Promise((resolve, reject) => {
      const requestStr = JSON.stringify(request) + '\n';
      
      console.log(`📤 Sending ${requestType} to MCP server...`);
      this.mcpProcess.stdin.write(requestStr);
      
      let responseData = '';
      let responseComplete = false;
      let timeoutId = null;
      
      // Set up response handler with detailed logging
      const responseHandler = (data) => {
        const chunk = data.toString();
        console.log(`📥 Raw MCP response chunk (${chunk.length} bytes):`, JSON.stringify(chunk));
        
        responseData += chunk;
        console.log(`📥 Accumulated response data (${responseData.length} bytes):`, JSON.stringify(responseData));
        
        // Try to find complete JSON responses
        const lines = responseData.split('\n');
        console.log(`📥 Split into ${lines.length} lines`);
        
        // Keep the last line if it's incomplete
        if (lines.length > 1) {
          responseData = lines.pop(); // Keep incomplete line
          console.log(`📥 Keeping incomplete line:`, JSON.stringify(responseData));
        }
        
        for (let i = 0; i < lines.length - 1; i++) {
          const line = lines[i].trim();
          console.log(`📥 Processing line ${i}:`, JSON.stringify(line));
          
          if (line) {
            try {
              const response = JSON.parse(line);
              console.log(`📥 Parsed JSON response:`, JSON.stringify(response, null, 2));
              
              if (response.id === request.id) {
                console.log(`📥 Found matching response for request ${request.id}`);
                this.mcpProcess.stdout.removeListener('data', responseHandler);
                responseComplete = true;
                if (timeoutId) clearTimeout(timeoutId);
                resolve(response);
                return;
              } else {
                console.log(`📥 Response ID ${response.id} doesn't match request ID ${request.id}`);
              }
            } catch (error) {
              console.log(`📥 Failed to parse line as JSON:`, error.message);
            }
          }
        }
      };
      
      this.mcpProcess.stdout.on('data', responseHandler);
      
      // Timeout with detailed logging
      timeoutId = setTimeout(() => {
        if (!responseComplete) {
          console.log(`⏰ TIMEOUT: ${requestType} request timed out after 15 seconds`);
          console.log(`📥 Final accumulated data:`, JSON.stringify(responseData));
          this.mcpProcess.stdout.removeListener('data', responseHandler);
          reject(new Error(`${requestType} request timeout - no response received`));
        }
      }, 15000);
    });
  }

  showDebugSummary() {
    console.log('\n📋 MCP Server Debug Summary');
    console.log('===========================\n');

    console.log('📊 Debug Log Statistics:');
    const stdoutCount = this.debugLog.filter(log => log.type === 'stdout').length;
    const stderrCount = this.debugLog.filter(log => log.type === 'stderr').length;
    const errorCount = this.debugLog.filter(log => log.type === 'process_error').length;
    
    console.log(`   Total log entries: ${this.debugLog.length}`);
    console.log(`   STDOUT entries: ${stdoutCount}`);
    console.log(`   STDERR entries: ${stderrCount}`);
    console.log(`   Process errors: ${errorCount}`);

    console.log('\n📤 Recent STDOUT entries:');
    this.debugLog
      .filter(log => log.type === 'stdout')
      .slice(-5)
      .forEach((log, index) => {
        console.log(`   ${index + 1}. [${new Date(log.timestamp).toISOString()}] ${log.data.trim()}`);
      });

    console.log('\n📤 Recent STDERR entries:');
    this.debugLog
      .filter(log => log.type === 'stderr')
      .slice(-5)
      .forEach((log, index) => {
        console.log(`   ${index + 1}. [${new Date(log.timestamp).toISOString()}] ${log.data.trim()}`);
      });

    console.log('\n🔍 Analysis:');
    
    // Check if MCP server is responding at all
    const hasStdout = stdoutCount > 0;
    const hasStderr = stderrCount > 0;
    const hasErrors = errorCount > 0;
    
    if (!hasStdout && !hasStderr) {
      console.log('   ❌ MCP server is not producing any output');
    } else if (hasStdout) {
      console.log('   ✅ MCP server is producing stdout output');
    }
    
    if (hasStderr) {
      console.log('   ⚠️  MCP server is producing stderr output (may be normal)');
    }
    
    if (hasErrors) {
      console.log('   ❌ MCP server has process errors');
    }

    // Check for specific patterns
    const hasJsonRpc = this.debugLog.some(log => log.data.includes('jsonrpc'));
    const hasError = this.debugLog.some(log => log.data.includes('error'));
    const hasBridge = this.debugLog.some(log => log.data.includes('bridge'));
    
    console.log(`   JSON-RPC responses: ${hasJsonRpc ? '✅' : '❌'}`);
    console.log(`   Error messages: ${hasError ? '⚠️' : '✅'}`);
    console.log(`   Bridge references: ${hasBridge ? '✅' : '❌'}`);

    console.log('\n💡 Recommendations:');
    if (!hasJsonRpc) {
      console.log('   - MCP server is not sending JSON-RPC responses');
      console.log('   - Check if MCP server is properly initialized');
    }
    if (hasError) {
      console.log('   - MCP server has error messages');
      console.log('   - Check stderr output for specific errors');
    }
    if (!hasBridge) {
      console.log('   - No bridge references found');
      console.log('   - MCP server may not be connecting to bridge');
    }
  }

  cleanup() {
    console.log('\n🧹 Cleaning up...');
    if (this.mcpProcess) {
      this.mcpProcess.kill();
      console.log('✅ MCP server stopped');
    }
  }
}

// Start the debugger
const mcpDebugger = new MCPServerDebugger();
mcpDebugger.start().catch(error => {
  console.error('❌ Debug failed:', error.message);
  process.exit(1);
}); 