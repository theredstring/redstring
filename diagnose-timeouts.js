#!/usr/bin/env node

/**
 * Detailed Timeout Diagnosis for Redstring AI Integration
 * 
 * This script provides step-by-step diagnosis of exactly where timeouts occur
 * and what's happening at each stage of the integration.
 */

import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class TimeoutDiagnostic {
  constructor() {
    this.mcpProcess = null;
    this.requestId = 1;
    this.diagnosticLog = [];
    this.bridgeUrl = 'http://localhost:3001';
  }

  async start() {
    console.log('🔍 Detailed Timeout Diagnosis for Redstring AI');
    console.log('==============================================\n');

    try {
      // Step 1: Check bridge server status
      await this.diagnoseBridgeServer();
      
      // Step 2: Start MCP server with detailed logging
      await this.startMCPServerWithDiagnostics();
      
      // Step 3: Test each step with timing
      await this.diagnoseEachStep();
      
      // Step 4: Show detailed analysis
      this.showDetailedAnalysis();
      
      // Cleanup
      this.cleanup();
      
    } catch (error) {
      console.error('❌ Diagnosis failed:', error.message);
      this.cleanup();
      process.exit(1);
    }
  }

  async diagnoseBridgeServer() {
    console.log('🔍 Step 1: Diagnosing Bridge Server...');
    
    const startTime = Date.now();
    
    try {
      console.log('   📡 Testing bridge health endpoint...');
      const response = await fetch(`${this.bridgeUrl}/health`);
      const healthTime = Date.now() - startTime;
      
      if (!response.ok) {
        throw new Error(`Health check failed: ${response.status}`);
      }
      
      const health = await response.json();
      console.log(`   ✅ Bridge health: ${health.status} (${healthTime}ms)`);
      
      console.log('   📡 Testing bridge state endpoint...');
      const stateStart = Date.now();
      const stateResponse = await fetch(`${this.bridgeUrl}/api/bridge/state`);
      const stateTime = Date.now() - stateStart;
      
      if (!stateResponse.ok) {
        throw new Error(`State endpoint failed: ${stateResponse.status}`);
      }
      
      const state = await stateResponse.json();
      console.log(`   ✅ Bridge state: ${state.graphs?.length || 0} graphs, ${state.nodePrototypes?.length || 0} prototypes (${stateTime}ms)`);
      
      this.diagnosticLog.push({
        step: 'bridge_server',
        success: true,
        timing: { health: healthTime, state: stateTime },
        data: { graphs: state.graphs?.length || 0, prototypes: state.nodePrototypes?.length || 0 }
      });
      
    } catch (error) {
      const totalTime = Date.now() - startTime;
      console.log(`   ❌ Bridge server failed: ${error.message} (${totalTime}ms)`);
      this.diagnosticLog.push({
        step: 'bridge_server',
        success: false,
        error: error.message,
        timing: { total: totalTime }
      });
      throw error;
    }
  }

  async startMCPServerWithDiagnostics() {
    console.log('\n🔌 Step 2: Starting MCP Server with Diagnostics...');
    
    const startTime = Date.now();
    
    return new Promise((resolve, reject) => {
      this.mcpProcess = spawn('node', [join(__dirname, 'redstring-mcp-server.js')], {
        cwd: __dirname,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let startupTimeout = setTimeout(() => {
        const timeoutTime = Date.now() - startTime;
        console.log(`   ⏰ MCP server startup timeout after ${timeoutTime}ms`);
        this.diagnosticLog.push({
          step: 'mcp_startup',
          success: false,
          error: 'Startup timeout',
          timing: { total: timeoutTime }
        });
        reject(new Error('MCP server startup timeout'));
      }, 15000);

      // Log ALL stderr output for diagnosis
      this.mcpProcess.stderr.on('data', (data) => {
        const output = data.toString();
        console.log(`   📤 MCP STDERR: ${output.trim()}`);
        
        if (output.includes('Redstring MCP Server running')) {
          const startupTime = Date.now() - startTime;
          clearTimeout(startupTimeout);
          console.log(`   ✅ MCP server started (${startupTime}ms)`);
          this.diagnosticLog.push({
            step: 'mcp_startup',
            success: true,
            timing: { total: startupTime }
          });
          resolve();
        }
      });

      this.mcpProcess.on('error', (error) => {
        const errorTime = Date.now() - startTime;
        console.log(`   ❌ MCP process error: ${error.message} (${errorTime}ms)`);
        clearTimeout(startupTimeout);
        this.diagnosticLog.push({
          step: 'mcp_startup',
          success: false,
          error: error.message,
          timing: { total: errorTime }
        });
        reject(error);
      });
    });
  }

  async diagnoseEachStep() {
    console.log('\n🔍 Step 3: Diagnosing Each Integration Step...');
    
    // Wait for MCP server to fully initialize
    console.log('   ⏳ Waiting for MCP server to initialize...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Test each step with detailed timing
    await this.diagnoseStep('initialize', this.createInitializeRequest());
    await this.diagnoseStep('tools_list', this.createToolsListRequest());
    await this.diagnoseStep('verify_state', this.createVerifyStateRequest());
    await this.diagnoseStep('list_graphs', this.createListGraphsRequest());
  }

  async diagnoseStep(stepName, request) {
    console.log(`\n🔧 Diagnosing: ${stepName}`);
    
    const startTime = Date.now();
    
    try {
      console.log(`   📤 Sending ${stepName} request...`);
      const sendTime = Date.now();
      
      const response = await this.sendRequestWithTiming(request, stepName);
      const totalTime = Date.now() - startTime;
      const responseTime = Date.now() - sendTime;
      
      if (response.result) {
        console.log(`   ✅ ${stepName} succeeded (${totalTime}ms total, ${responseTime}ms response)`);
        
        // Analyze response content
        const contentAnalysis = this.analyzeResponseContent(response, stepName);
        console.log(`   📄 Content: ${contentAnalysis}`);
        
        this.diagnosticLog.push({
          step: stepName,
          success: true,
          timing: { total: totalTime, response: responseTime },
          content: contentAnalysis
        });
      } else if (response.error) {
        console.log(`   ❌ ${stepName} failed: ${response.error.message} (${totalTime}ms)`);
        this.diagnosticLog.push({
          step: stepName,
          success: false,
          error: response.error.message,
          timing: { total: totalTime }
        });
      }
    } catch (error) {
      const totalTime = Date.now() - startTime;
      console.log(`   ❌ ${stepName} error: ${error.message} (${totalTime}ms)`);
      this.diagnosticLog.push({
        step: stepName,
        success: false,
        error: error.message,
        timing: { total: totalTime }
      });
    }
  }

  createInitializeRequest() {
    return {
      jsonrpc: '2.0',
      id: this.requestId++,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        clientInfo: { name: 'Timeout Diagnostic', version: '1.0.0' }
      }
    };
  }

  createToolsListRequest() {
    return {
      jsonrpc: '2.0',
      id: this.requestId++,
      method: 'tools/list',
      params: {}
    };
  }

  createVerifyStateRequest() {
    return {
      jsonrpc: '2.0',
      id: this.requestId++,
      method: 'tools/call',
      params: {
        name: 'verify_state',
        arguments: {}
      }
    };
  }

  createListGraphsRequest() {
    return {
      jsonrpc: '2.0',
      id: this.requestId++,
      method: 'tools/call',
      params: {
        name: 'list_available_graphs',
        arguments: {}
      }
    };
  }

  async sendRequestWithTiming(request, stepName) {
    return new Promise((resolve, reject) => {
      const requestStr = JSON.stringify(request) + '\n';
      
      this.mcpProcess.stdin.write(requestStr);
      
      let responseData = '';
      let responseComplete = false;
      let timeoutId = null;
      let firstChunkTime = null;
      let lastChunkTime = null;
      
      const responseHandler = (data) => {
        const chunkTime = Date.now();
        if (!firstChunkTime) firstChunkTime = chunkTime;
        lastChunkTime = chunkTime;
        
        const chunk = data.toString();
        console.log(`   📥 Received chunk (${chunk.length} bytes) at ${chunkTime}ms`);
        
        responseData += chunk;
        
        const lines = responseData.split('\n');
        
        for (let i = 0; i < lines.length - 1; i++) {
          const line = lines[i].trim();
          
          if (line) {
            try {
              const response = JSON.parse(line);
              
              if (response.id === request.id) {
                const totalResponseTime = lastChunkTime - firstChunkTime;
                console.log(`   📥 Found matching response for ${stepName} (${totalResponseTime}ms)`);
                
                this.mcpProcess.stdout.removeListener('data', responseHandler);
                responseComplete = true;
                if (timeoutId) clearTimeout(timeoutId);
                resolve(response);
                return;
              }
            } catch (error) {
              // Ignore parsing errors for non-JSON output
            }
          }
        }
        
        responseData = lines[lines.length - 1];
      };
      
      this.mcpProcess.stdout.on('data', responseHandler);
      
      timeoutId = setTimeout(() => {
        if (!responseComplete) {
          const timeoutTime = Date.now();
          console.log(`   ⏰ TIMEOUT: ${stepName} timed out at ${timeoutTime}ms`);
          console.log(`   📥 Final accumulated data: ${responseData.length} bytes`);
          this.mcpProcess.stdout.removeListener('data', responseHandler);
          reject(new Error(`${stepName} request timeout - no response received`));
        }
      }, 30000);
    });
  }

  analyzeResponseContent(response, stepName) {
    if (!response.result || !response.result.content || !response.result.content[0]) {
      return 'No content in response';
    }
    
    const content = response.result.content[0].text;
    
    switch (stepName) {
      case 'initialize':
        return `Server: ${response.result.serverInfo?.name || 'Unknown'} v${response.result.serverInfo?.version || 'Unknown'}`;
      
      case 'tools_list':
        const toolCount = response.result.tools?.length || 0;
        return `${toolCount} tools available`;
      
      case 'verify_state':
        if (content.includes('Bridge Server: Running on localhost:3001')) {
          return 'Bridge connected - shows bridge status';
        } else if (content.includes('Redstring store bridge not available')) {
          return 'Bridge NOT connected - shows error message';
        } else {
          return 'Bridge status unclear - check content';
        }
      
      case 'list_graphs':
        if (content.includes('Available Knowledge Graphs')) {
          return 'Shows real graph data';
        } else {
          return 'No graph data or error';
        }
      
      default:
        return `Content length: ${content.length} chars`;
    }
  }

  showDetailedAnalysis() {
    console.log('\n📋 Detailed Timeout Analysis');
    console.log('============================\n');

    console.log('🔍 Step-by-Step Analysis:');
    this.diagnosticLog.forEach((log, index) => {
      const status = log.success ? '✅' : '❌';
      const timing = log.timing ? ` (${JSON.stringify(log.timing)}ms)` : '';
      const details = log.content ? ` - ${log.content}` : '';
      const error = log.error ? ` - ERROR: ${log.error}` : '';
      console.log(`   ${index + 1}. ${status} ${log.step}${timing}${details}${error}`);
    });

    console.log('\n🔍 Key Findings:');
    
    const bridgeLog = this.diagnosticLog.find(l => l.step === 'bridge_server');
    const mcpLog = this.diagnosticLog.find(l => l.step === 'mcp_startup');
    const verifyLog = this.diagnosticLog.find(l => l.step === 'verify_state');
    
    if (bridgeLog?.success) {
      console.log('   ✅ Bridge server is accessible and responsive');
      console.log(`      Health: ${bridgeLog.timing.health}ms`);
      console.log(`      State: ${bridgeLog.timing.state}ms`);
    } else {
      console.log('   ❌ Bridge server is not accessible');
    }
    
    if (mcpLog?.success) {
      console.log('   ✅ MCP server starts successfully');
      console.log(`      Startup: ${mcpLog.timing.total}ms`);
    } else {
      console.log('   ❌ MCP server fails to start');
    }
    
    if (verifyLog?.success) {
      if (verifyLog.content?.includes('Bridge connected')) {
        console.log('   ✅ MCP server is properly connected to bridge');
      } else {
        console.log('   ⚠️  MCP server is NOT properly connected to bridge');
        console.log('      (But can still access data via HTTP)');
      }
    } else {
      console.log('   ❌ Cannot verify bridge connectivity');
    }

    console.log('\n🎯 Recommendations:');
    
    const failedSteps = this.diagnosticLog.filter(l => !l.success);
    if (failedSteps.length === 0) {
      console.log('   🎉 All steps completed successfully!');
    } else {
      console.log(`   ⚠️  ${failedSteps.length} steps failed:`);
      failedSteps.forEach(step => {
        console.log(`      - ${step.step}: ${step.error}`);
      });
    }
    
    const slowSteps = this.diagnosticLog.filter(l => l.timing?.total > 5000);
    if (slowSteps.length > 0) {
      console.log(`   ⏱️  ${slowSteps.length} steps were slow (>5s):`);
      slowSteps.forEach(step => {
        console.log(`      - ${step.step}: ${step.timing.total}ms`);
      });
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

// Start the diagnosis
const diagnostic = new TimeoutDiagnostic();
diagnostic.start().catch(error => {
  console.error('❌ Diagnosis failed:', error.message);
  process.exit(1);
}); 