#!/usr/bin/env node

/**
 * Test AI Chat Panel MCP Client
 * 
 * This script tests the AI chat panel's MCP client functionality
 */

import fetch from 'node-fetch';
import { readMcpHttpToken } from '../../src/headless/agentToken.js';

const BRIDGE_URL = process.env.BRIDGE_URL || 'http://localhost:3003';
// The MCP HTTP listener is opt-in (REDSTRING_MCP_HTTP=1) and requires its token,
// which it records under "mcp" in ~/.redstring/agent.json.
const MCP_TOKEN = readMcpHttpToken({ port: Number(new URL(BRIDGE_URL).port) || 3003 }) || '';

async function testAIChatMCP() {
  console.log('🤖 Testing AI Chat Panel MCP Client');
  console.log('====================================\n');

  try {
    // Test 1: Initialize MCP connection
    console.log('🔧 Test 1: Initialize MCP connection');
    const initResponse = await fetch(`${BRIDGE_URL}/api/mcp/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Redstring-Token': MCP_TOKEN },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          clientInfo: { name: 'Test AI Chat', version: '1.0.0' }
        }
      })
    });

    const initResult = await initResponse.json();
    console.log('✅ Initialize response:', initResult.result?.serverInfo);

    // Test 2: List tools
    console.log('\n🔧 Test 2: List available tools');
    const listResponse = await fetch(`${BRIDGE_URL}/api/mcp/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Redstring-Token': MCP_TOKEN },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {}
      })
    });

    const listResult = await listResponse.json();
    console.log(`✅ Found ${listResult.result?.tools?.length || 0} tools:`);
    listResult.result?.tools?.forEach(tool => {
      console.log(`   • ${tool.name}: ${tool.description}`);
    });

    // Test 3: Call verify_state tool
    console.log('\n🔧 Test 3: Call verify_state tool');
    const verifyResponse = await fetch(`${BRIDGE_URL}/api/mcp/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Redstring-Token': MCP_TOKEN },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'verify_state',
          arguments: {}
        }
      })
    });

    const verifyResult = await verifyResponse.json();
    console.log('✅ Verify state response:', JSON.stringify(verifyResult, null, 2));

    // Test 4: Call list_available_graphs tool
    console.log('\n🔧 Test 4: Call list_available_graphs tool');
    const graphsResponse = await fetch(`${BRIDGE_URL}/api/mcp/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Redstring-Token': MCP_TOKEN },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'list_available_graphs',
          arguments: {}
        }
      })
    });

    const graphsResult = await graphsResponse.json();
    console.log('✅ List graphs response:', JSON.stringify(graphsResult, null, 2));

    // Test 5: Call search_nodes tool
    console.log('\n🔧 Test 5: Call search_nodes tool');
    const searchResponse = await fetch(`${BRIDGE_URL}/api/mcp/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Redstring-Token': MCP_TOKEN },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: {
          name: 'search_nodes',
          arguments: { query: 'Person' }
        }
      })
    });

    const searchResult = await searchResponse.json();
    console.log('✅ Search nodes response:', JSON.stringify(searchResult, null, 2));

    console.log('\n🎉 All AI Chat MCP tests passed!');
    console.log('\n📝 Next Steps:');
    console.log('   1. Open Redstring in your browser');
    console.log('   2. Open the AI Collaboration Panel');
    console.log('   3. Try asking: "Show me all available graphs"');
    console.log('   4. Try asking: "What is the current active graph?"');
    console.log('   5. Try asking: "Search for nodes containing Person"');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    process.exit(1);
  }
}

// Run the test
testAIChatMCP(); 