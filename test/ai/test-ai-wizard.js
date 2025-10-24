#!/usr/bin/env node

/**
 * Test AI Wizard for Redstring
 * 
 * This is a test version of the AI connection wizard that properly handles
 * both the bridge server and MCP server, with detailed diagnostics.
 */

import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class TestAIWizard {
  constructor() {
    this.bridgeProcess = null;
    this.mcpProcess = null;
    this.requestId = 1;
    this.testResults = [];
    this.bridgeUrl = 'http://localhost:3001';
    this.redstringUrl = 'http://localhost:4000';
  }

  async start() {
    console.log('🤖 Test AI Wizard for Redstring');
    console.log('===============================\n');

    try {
      // Step 1: Check if services are already running
      await this.checkExistingServices();
      
      // Step 2: Start bridge server if needed
      await this.startBridgeServer();
      
      // Step 3: Start MCP server
      await this.startMCPServer();
      
      // Step 4: Test the complete integration
      await this.testCompleteIntegration();
      
      // Step 5: Generate comprehensive report
      this.generateReport();
      
      // Step 6: Keep running for manual testing
      await this.keepRunning();
      
    } catch (error) {
      console.error('❌ Test wizard failed:', error.message);
      this.cleanup();
      process.exit(1);
    }
  }

  async checkExistingServices() {
    console.log('🔍 Step 1: Checking existing services...');
    
    const services = {
      bridge: false,
      redstring: false,
      mcp: false
    };

    // Check bridge server
    try {
      const response = await fetch(`${this.bridgeUrl}/health`);
      if (response.ok) {
        console.log('✅ Bridge server is already running');
        services.bridge = true;
      }
    } catch (error) {
      console.log('❌ Bridge server is not running');
    }

    // Check Redstring app
    try {
      const response = await fetch(`${this.redstringUrl}`);
      if (response.ok) {
        console.log('✅ Redstring app is running');
        services.redstring = true;
      }
    } catch (error) {
      console.log('❌ Redstring app is not running');
    }

    this.testResults.push({
      step: 'existing_services',
      success: services.bridge || services.redstring,
      details: services
    });

    return services;
  }

  async startBridgeServer() {
    console.log('\n🔌 Step 2: Starting Bridge Server...');
    
    // Check if bridge is already running
    try {
      const response = await fetch(`${this.bridgeUrl}/health`);
      if (response.ok) {
        console.log('✅ Bridge server is already running');
        this.testResults.push({
          step: 'bridge_server',
          success: true,
          details: { status: 'already_running' }
        });
        return;
      }
    } catch (error) {
      // Bridge not running, start it
    }

    return new Promise((resolve, reject) => {
      this.bridgeProcess = spawn('node', [join(__dirname, 'server.js')], {
        cwd: __dirname,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let startupTimeout = setTimeout(() => {
        reject(new Error('Bridge server startup timeout'));
      }, 10000);

      this.bridgeProcess.stdout.on('data', (data) => {
        const output = data.toString();
        console.log(`   📤 Bridge STDOUT: ${output.trim()}`);
        
        if (output.includes('server running') || output.includes('Server running')) {
          clearTimeout(startupTimeout);
          console.log('✅ Bridge server started');
          this.testResults.push({
            step: 'bridge_server',
            success: true,
            details: { status: 'started' }
          });
          resolve();
        }
      });

      this.bridgeProcess.stderr.on('data', (data) => {
        const error = data.toString();
        console.log(`   📤 Bridge STDERR: ${error.trim()}`);
      });

      this.bridgeProcess.on('error', (error) => {
        clearTimeout(startupTimeout);
        console.log(`   ❌ Bridge process error: ${error.message}`);
        this.testResults.push({
          step: 'bridge_server',
          success: false,
          error: error.message
        });
        reject(error);
      });
    });
  }

  async startMCPServer() {
    console.log('\n🔌 Step 3: Starting MCP Server...');
    
    return new Promise((resolve, reject) => {
      this.mcpProcess = spawn('node', [join(__dirname, 'redstring-mcp-server.js')], {
        cwd: __dirname,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let startupTimeout = setTimeout(() => {
        reject(new Error('MCP server startup timeout'));
      }, 10000);

      this.mcpProcess.stderr.on('data', (data) => {
        const output = data.toString();
        console.log(`   📤 MCP STDERR: ${output.trim()}`);
        
        if (output.includes('Redstring MCP Server running')) {
          clearTimeout(startupTimeout);
          console.log('✅ MCP server started');
          this.testResults.push({
            step: 'mcp_server',
            success: true,
            details: { status: 'started' }
          });
          resolve();
        }
      });

      this.mcpProcess.on('error', (error) => {
        clearTimeout(startupTimeout);
        console.log(`   ❌ MCP process error: ${error.message}`);
        this.testResults.push({
          step: 'mcp_server',
          success: false,
          error: error.message
        });
        reject(error);
      });
    });
  }

  async testCompleteIntegration() {
    console.log('\n🧪 Step 4: Testing Complete Integration...');
    
    // Wait for servers to fully initialize
    console.log('   ⏳ Waiting for servers to initialize...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Test bridge connectivity
    await this.testBridgeConnectivity();
    
    // Test MCP connectivity
    await this.testMCPConnectivity();
    
    // Test individual tools
    await this.testIndividualTools();
  }

  async testBridgeConnectivity() {
    console.log('\n🔗 Testing Bridge Connectivity...');
    
    try {
      const response = await fetch(`${this.bridgeUrl}/health`);
      if (!response.ok) {
        throw new Error(`Health check failed: ${response.status}`);
      }
      
      const health = await response.json();
      console.log('   ✅ Bridge health check passed');
      
      const stateResponse = await fetch(`${this.bridgeUrl}/api/bridge/state`);
      if (!stateResponse.ok) {
        throw new Error(`State endpoint failed: ${stateResponse.status}`);
      }
      
      const state = await stateResponse.json();
      console.log(`   ✅ Bridge state accessible: ${state.graphs?.length || 0} graphs, ${state.nodePrototypes?.length || 0} prototypes`);
      
      this.testResults.push({
        step: 'bridge_connectivity',
        success: true,
        details: {
          health: health.status,
          graphs: state.graphs?.length || 0,
          prototypes: state.nodePrototypes?.length || 0
        }
      });
      
    } catch (error) {
      console.log(`   ❌ Bridge connectivity failed: ${error.message}`);
      this.testResults.push({
        step: 'bridge_connectivity',
        success: false,
        error: error.message
      });
    }
  }

  async testMCPConnectivity() {
    console.log('\n🔗 Testing MCP Connectivity...');
    
    const initRequest = {
      jsonrpc: '2.0',
      id: this.requestId++,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        clientInfo: { name: 'Test AI Wizard', version: '1.0.0' }
      }
    };

    try {
      const response = await this.sendRequest(initRequest);
      
      if (response.result) {
        console.log('   ✅ MCP initialization succeeded');
        console.log(`   📄 Server: ${response.result.serverInfo?.name || 'Unknown'} v${response.result.serverInfo?.version || 'Unknown'}`);
        
        this.testResults.push({
          step: 'mcp_connectivity',
          success: true,
          details: {
            server: response.result.serverInfo?.name || 'Unknown',
            version: response.result.serverInfo?.version || 'Unknown'
          }
        });
      } else if (response.error) {
        throw new Error(response.error.message);
      }
    } catch (error) {
      console.log(`   ❌ MCP connectivity failed: ${error.message}`);
      this.testResults.push({
        step: 'mcp_connectivity',
        success: false,
        error: error.message
      });
    }
  }

  async testIndividualTools() {
    console.log('\n🔧 Testing Individual Tools...\n');
    
    const toolsToTest = [
      { name: 'verify_state', params: {}, description: 'Verify Redstring store state' },
      { name: 'list_available_graphs', params: {}, description: 'List all available graphs' },
      { name: 'get_active_graph', params: {}, description: 'Get currently active graph' },
      { name: 'search_nodes', params: { query: 'Person' }, description: 'Search for nodes containing "Person"' }
    ];

    for (const tool of toolsToTest) {
      await this.testSingleTool(tool.name, tool.params, tool.description);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  async testSingleTool(toolName, params, description) {
    console.log(`🔧 Testing: ${description}`);
    
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
      
      if (response.result && response.result.content && response.result.content[0]) {
        console.log(`   ✅ ${toolName} succeeded`);
        
        // Check if response contains real data
        const content = response.result.content[0].text;
        if (content.includes('❌') || content.includes('Error') || content.includes('Failed')) {
          console.log(`   ⚠️  ${toolName} returned error in content`);
          this.testResults.push({ test: toolName, success: false, error: 'Error in response content' });
        } else {
          console.log(`   📄 Response contains real data`);
          this.testResults.push({ test: toolName, success: true });
        }
      } else if (response.error) {
        console.log(`   ❌ ${toolName} failed: ${response.error.message}`);
        this.testResults.push({ test: toolName, success: false, error: response.error.message });
      }
    } catch (error) {
      console.log(`   ❌ ${toolName} error: ${error.message}`);
      this.testResults.push({ test: toolName, success: false, error: error.message });
    }
  }

  async sendRequest(request) {
    return new Promise((resolve, reject) => {
      const requestStr = JSON.stringify(request) + '\n';
      
      this.mcpProcess.stdin.write(requestStr);
      
      let responseData = '';
      let responseComplete = false;
      let timeoutId = null;
      
      const responseHandler = (data) => {
        responseData += data.toString();
        
        const lines = responseData.split('\n');
        
        for (let i = 0; i < lines.length - 1; i++) {
          const line = lines[i].trim();
          
          if (line) {
            try {
              const response = JSON.parse(line);
              
              if (response.id === request.id) {
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
          this.mcpProcess.stdout.removeListener('data', responseHandler);
          reject(new Error(`Request timeout for ${request.method}`));
        }
      }, 30000);
    });
  }

  generateReport() {
    console.log('\n📋 Test AI Wizard Report');
    console.log('========================\n');

    const totalTests = this.testResults.length;
    const successfulTests = this.testResults.filter(r => r.success).length;
    const failedTests = totalTests - successfulTests;

    console.log(`📊 Test Summary:`);
    console.log(`   Total Tests: ${totalTests}`);
    console.log(`   Successful: ${successfulTests}`);
    console.log(`   Failed: ${failedTests}`);
    console.log(`   Success Rate: ${((successfulTests / totalTests) * 100).toFixed(1)}%\n`);

    console.log('🔧 Test Results:');
    this.testResults.forEach((result, index) => {
      const status = result.success ? '✅' : '❌';
      const details = result.details ? ` - ${JSON.stringify(result.details)}` : '';
      const error = result.error ? ` - ERROR: ${result.error}` : '';
      console.log(`   ${index + 1}. ${status} ${result.test || result.step}${details}${error}`);
    });

    console.log('\n🚀 Integration Status:');
    
    const bridgeTest = this.testResults.find(r => r.step === 'bridge_server');
    const mcpTest = this.testResults.find(r => r.step === 'mcp_server');
    const connectivityTest = this.testResults.find(r => r.step === 'bridge_connectivity');
    
    if (bridgeTest?.success) {
      console.log('   ✅ Bridge Server: Running');
    } else {
      console.log('   ❌ Bridge Server: Failed');
    }
    
    if (mcpTest?.success) {
      console.log('   ✅ MCP Server: Running');
    } else {
      console.log('   ❌ MCP Server: Failed');
    }
    
    if (connectivityTest?.success) {
      console.log('   ✅ Bridge Connectivity: Working');
      if (connectivityTest.details) {
        console.log(`      Graphs: ${connectivityTest.details.graphs}`);
        console.log(`      Prototypes: ${connectivityTest.details.prototypes}`);
      }
    } else {
      console.log('   ❌ Bridge Connectivity: Failed');
    }

    if (successfulTests === totalTests) {
      console.log('\n🎉 ALL TESTS PASSED! The AI integration is fully functional!');
      console.log('\n🎯 You can now use this as Claude Desktop:');
      console.log('   - Bridge server is running');
      console.log('   - MCP server is connected');
      console.log('   - All tools are working');
      console.log('   - Ready for AI client configuration');
    } else if (successfulTests > totalTests / 2) {
      console.log('\n⚠️  Most tests working. Some components need attention.');
    } else {
      console.log('\n❌ Many tests failed. Check the error messages above.');
    }
  }

  async keepRunning() {
    console.log('\n🔄 Keeping servers running for manual testing...');
    console.log('   Press Ctrl+C to stop all servers');
    console.log('   Bridge server: http://localhost:3001');
    console.log('   MCP server: Running on stdio');
    console.log('   Redstring app: http://localhost:4000');
    
    // Keep the process alive
    process.on('SIGINT', () => {
      console.log('\n🛑 Received SIGINT, shutting down...');
      this.cleanup();
      process.exit(0);
    });
    
    // Keep running indefinitely
    await new Promise(() => {});
  }

  cleanup() {
    console.log('\n🧹 Cleaning up...');
    
    if (this.bridgeProcess) {
      this.bridgeProcess.kill();
      console.log('✅ Bridge server stopped');
    }
    
    if (this.mcpProcess) {
      this.mcpProcess.kill();
      console.log('✅ MCP server stopped');
    }
  }
}

// Start the test wizard
const wizard = new TestAIWizard();
wizard.start().catch(error => {
  console.error('❌ Test wizard failed:', error.message);
  process.exit(1);
}); 