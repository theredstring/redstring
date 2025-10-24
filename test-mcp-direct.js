#!/usr/bin/env node

/**
 * Direct MCP Protocol Test
 * Tests the high-level tools directly via MCP protocol
 */

import { spawn } from 'child_process';

async function testMCPTools() {
  console.log('🧪 Testing MCP Tools Directly...\n');

  const mcpProcess = spawn('node', ['redstring-mcp-server.js'], {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  let requestId = 1;

  function sendRequest(method, params = {}) {
    const request = {
      jsonrpc: '2.0',
      id: requestId++,
      method: method,
      params: params
    };
    
    console.log(`📤 Sending: ${method}`);
    mcpProcess.stdin.write(JSON.stringify(request) + '\n');
  }

  function waitForResponse() {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve({ error: 'Timeout' });
      }, 5000);

      mcpProcess.stdout.once('data', (data) => {
        clearTimeout(timeout);
        try {
          const response = JSON.parse(data.toString());
          console.log(`📥 Received: ${JSON.stringify(response, null, 2)}`);
          resolve(response);
        } catch (error) {
          resolve({ error: 'Invalid JSON' });
        }
      });
    });
  }

  try {
    // Test 1: List tools
    console.log('📋 Test 1: Listing available tools...');
    sendRequest('tools/list');
    const toolsResponse = await waitForResponse();
    
    if (toolsResponse.result && toolsResponse.result.tools) {
      const toolNames = toolsResponse.result.tools.map(t => t.name);
      console.log('✅ Available tools:', toolNames);
      
      // Check if our high-level tools are there
      if (toolNames.includes('addNodeToGraph')) {
        console.log('✅ addNodeToGraph tool found!');
      } else {
        console.log('❌ addNodeToGraph tool not found');
      }
      
      if (toolNames.includes('removeNodeFromGraph')) {
        console.log('✅ removeNodeFromGraph tool found!');
      } else {
        console.log('❌ removeNodeFromGraph tool not found');
      }
    }

    // Test 2: Try to call addNodeToGraph
    console.log('\n📋 Test 2: Testing addNodeToGraph...');
    sendRequest('tools/call', {
      name: 'addNodeToGraph',
      arguments: {
        conceptName: 'MCP Test Concept',
        description: 'Testing MCP direct call',
        position: { x: 400, y: 400 },
        color: '#FF6B6B'
      }
    });
    
    const addResponse = await waitForResponse();
    if (addResponse.result) {
      console.log('✅ addNodeToGraph call successful!');
    } else {
      console.log('❌ addNodeToGraph call failed:', addResponse.error);
    }

  } catch (error) {
    console.error('❌ Test failed:', error.message);
  } finally {
    mcpProcess.kill();
  }
}

// Run the test
testMCPTools(); 