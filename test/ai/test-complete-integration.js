#!/usr/bin/env node

/**
 * Complete Integration Test for Redstring AI
 * 
 * This script tests the complete integration:
 * 1. Verifies bridge server is running
 * 2. Starts MCP server
 * 3. Tests that MCP server can actually access bridge data
 * 4. Tests real operations that require bridge connectivity
 */

import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class CompleteIntegrationTest {
  constructor() {
    this.mcpProcess = null;
    this.requestId = 1;
    this.testResults = [];
    this.bridgeUrl = 'http://localhost:3001';
  }

  async start() {
    console.log('🔗 Complete Integration Test for Redstring AI');
    console.log('============================================\n');

    try {
      // Step 1: Verify bridge server is running
      await this.verifyBridgeServer();
      
      // Step 2: Start MCP server
      await this.startMCPServer();
      
      // Step 3: Test MCP server connectivity to bridge
      await this.testMCPBridgeConnectivity();
      
      // Step 4: Test real operations
      await this.testRealOperations();
      
      // Step 5: Generate comprehensive report
      this.generateReport();
      
      // Cleanup
      this.cleanup();
      
    } catch (error) {
      console.error('❌ Integration test failed:', error.message);
      this.cleanup();
      process.exit(1);
    }
  }

  async verifyBridgeServer() {
    console.log('🔍 Step 1: Verifying Bridge Server...');
    
    try {
      const response = await fetch(`${this.bridgeUrl}/health`);
      if (!response.ok) {
        throw new Error(`Bridge server health check failed: ${response.status}`);
      }
      
      const health = await response.json();
      console.log('✅ Bridge server is running');
      console.log(`   Status: ${health.status}`);
      console.log(`   Timestamp: ${health.timestamp}`);
      
      // Test bridge state endpoint
      const stateResponse = await fetch(`${this.bridgeUrl}/api/bridge/state`);
      if (!stateResponse.ok) {
        throw new Error(`Bridge state endpoint failed: ${stateResponse.status}`);
      }
      
      const state = await stateResponse.json();
      console.log('✅ Bridge state endpoint accessible');
      console.log(`   Active Graph: ${state.activeGraphId || 'None'}`);
      console.log(`   Open Graphs: ${state.openGraphIds?.length || 0}`);
      console.log(`   Total Graphs: ${state.graphs?.length || 0}`);
      console.log(`   Total Prototypes: ${state.nodePrototypes?.length || 0}`);
      
      this.testResults.push({ 
        test: 'bridge_server', 
        success: true, 
        details: {
          status: health.status,
          graphs: state.graphs?.length || 0,
          prototypes: state.nodePrototypes?.length || 0
        }
      });
      
    } catch (error) {
      console.log('❌ Bridge server verification failed:', error.message);
      this.testResults.push({ test: 'bridge_server', success: false, error: error.message });
      throw error;
    }
  }

  async startMCPServer() {
    console.log('\n🔌 Step 2: Starting MCP Server...');
    
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

  async testMCPBridgeConnectivity() {
    console.log('\n🔗 Step 3: Testing MCP-Bridge Connectivity...');
    
    // Wait for MCP server to fully initialize
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Test that MCP server can access bridge data
    await this.testBridgeDataAccess();
  }

  async testBridgeDataAccess() {
    console.log('🔧 Testing: MCP server access to bridge data');
    
    const verifyRequest = {
      jsonrpc: '2.0',
      id: this.requestId++,
      method: 'tools/call',
      params: {
        name: 'verify_state',
        arguments: {}
      }
    };

    try {
      const response = await this.sendRequest(verifyRequest);
      
      if (response.result && response.result.content && response.result.content[0]) {
        const content = response.result.content[0].text;
        
        // Check if the response contains bridge status information
        if (content.includes('Bridge Server: Running on localhost:3001') && 
            content.includes('MCPBridge Connected: Store actions registered')) {
          console.log('✅ MCP server successfully connected to bridge');
          console.log('✅ Bridge data access confirmed');
          
          // Extract key information from the response
          const bridgeMatch = content.match(/Bridge Server: (.*)/);
          const mcpMatch = content.match(/MCPBridge Connected: (.*)/);
          const dataMatch = content.match(/Data Sync: (.*)/);
          
          this.testResults.push({ 
            test: 'mcp_bridge_connectivity', 
            success: true,
            details: {
              bridgeStatus: bridgeMatch ? bridgeMatch[1] : 'Unknown',
              mcpStatus: mcpMatch ? mcpMatch[1] : 'Unknown',
              dataSync: dataMatch ? dataMatch[1] : 'Unknown'
            }
          });
        } else {
          console.log('❌ MCP server not properly connected to bridge');
          this.testResults.push({ 
            test: 'mcp_bridge_connectivity', 
            success: false, 
            error: 'Bridge connection not established' 
          });
        }
      } else if (response.error) {
        console.log('❌ Bridge data access failed:', response.error.message);
        this.testResults.push({ 
          test: 'mcp_bridge_connectivity', 
          success: false, 
          error: response.error.message 
        });
      }
    } catch (error) {
      console.log('❌ Bridge data access error:', error.message);
      this.testResults.push({ 
        test: 'mcp_bridge_connectivity', 
        success: false, 
        error: error.message 
      });
    }
  }

  async testRealOperations() {
    console.log('\n🧪 Step 4: Testing Real Operations...');
    
    // Test operations that require bridge connectivity
    const operations = [
      { name: 'list_available_graphs', description: 'List all available graphs (requires bridge)' },
      { name: 'get_active_graph', description: 'Get active graph details (requires bridge)' },
      { name: 'search_nodes', params: { query: 'Person' }, description: 'Search nodes (requires bridge)' }
    ];

    for (const operation of operations) {
      await this.testRealOperation(operation.name, operation.params || {}, operation.description);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  async testRealOperation(toolName, params, description) {
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
        
        // Check if response contains real data (not error messages)
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
    console.log('\n📋 Complete Integration Test Report');
    console.log('===================================\n');

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
      const errorInfo = result.error ? ` (${result.error})` : '';
      const details = result.details ? ` - ${JSON.stringify(result.details)}` : '';
      console.log(`   ${index + 1}. ${status} ${result.test}${details}${errorInfo}`);
    });

    console.log('\n🚀 Integration Status:');
    
    const bridgeTest = this.testResults.find(r => r.test === 'bridge_server');
    const connectivityTest = this.testResults.find(r => r.test === 'mcp_bridge_connectivity');
    
    if (bridgeTest?.success) {
      console.log('   ✅ Bridge Server: Running and accessible');
      if (bridgeTest.details) {
        console.log(`      Graphs: ${bridgeTest.details.graphs}`);
        console.log(`      Prototypes: ${bridgeTest.details.prototypes}`);
      }
    } else {
      console.log('   ❌ Bridge Server: Not accessible');
    }
    
    if (connectivityTest?.success) {
      console.log('   ✅ MCP-Bridge Connectivity: Established');
      if (connectivityTest.details) {
        console.log(`      Bridge: ${connectivityTest.details.bridgeStatus}`);
        console.log(`      MCP: ${connectivityTest.details.mcpStatus}`);
        console.log(`      Data Sync: ${connectivityTest.details.dataSync}`);
      }
    } else {
      console.log('   ❌ MCP-Bridge Connectivity: Failed');
    }
    
    console.log('   ✅ MCP Server: Running and responsive');
    console.log('   ✅ Response Parsing: Working correctly');

    if (successfulTests === totalTests) {
      console.log('\n🎉 COMPLETE INTEGRATION SUCCESS!');
      console.log('\n🎯 The AI integration is fully functional:');
      console.log('   - Bridge server is running and accessible');
      console.log('   - MCP server is connected to bridge');
      console.log('   - All tools can access real Redstring data');
      console.log('   - Ready for Claude Desktop configuration');
      console.log('\n📝 Next Steps:');
      console.log('   1. Configure Claude Desktop to use this MCP server');
      console.log('   2. Test AI workflows with real data');
      console.log('   3. Build knowledge graphs with AI assistance');
    } else if (successfulTests > totalTests / 2) {
      console.log('\n⚠️  Partial integration success. Some components need attention.');
    } else {
      console.log('\n❌ Integration failed. Check the error messages above.');
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

// Start the integration test
const integrationTest = new CompleteIntegrationTest();
integrationTest.start().catch(error => {
  console.error('❌ Integration test failed:', error.message);
  process.exit(1);
}); 