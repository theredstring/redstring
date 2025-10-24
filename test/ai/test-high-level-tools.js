#!/usr/bin/env node

/**
 * Test script for the new high-level MCP tools
 * Tests addNodeToGraph and removeNodeFromGraph functionality
 */

import fetch from 'node-fetch';

async function testHighLevelTools() {
  console.log('🧪 Testing High-Level MCP Tools...\n');

  const MCP_SERVER_URL = 'http://localhost:3001/api/mcp';

  try {
    // Test 1: Add a concept to graph
    console.log('📋 Test 1: Adding concept to graph...');
    
    const addResponse = await fetch(`${MCP_SERVER_URL}/tools/addNodeToGraph`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        conceptName: 'Test Concept',
        description: 'A test concept for high-level tool testing',
        position: { x: 200, y: 200 },
        color: '#FF6B6B'
      })
    });

    if (!addResponse.ok) {
      throw new Error(`HTTP ${addResponse.status}: ${addResponse.statusText}`);
    }

    const addResult = await addResponse.json();
    console.log('✅ Add result:', JSON.stringify(addResult, null, 2));

    // Test 2: Get graph instances to verify
    console.log('\n📋 Test 2: Getting graph instances...');
    
    const instancesResponse = await fetch(`${MCP_SERVER_URL}/tools/get_graph_instances`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({})
    });

    if (!instancesResponse.ok) {
      throw new Error(`HTTP ${instancesResponse.status}: ${instancesResponse.statusText}`);
    }

    const instancesResult = await instancesResponse.json();
    console.log('✅ Instances result:', JSON.stringify(instancesResult, null, 2));

    // Test 3: Remove the concept
    console.log('\n📋 Test 3: Removing concept from graph...');
    
    const removeResponse = await fetch(`${MCP_SERVER_URL}/tools/removeNodeFromGraph`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        conceptName: 'Test Concept'
      })
    });

    if (!removeResponse.ok) {
      throw new Error(`HTTP ${removeResponse.status}: ${removeResponse.statusText}`);
    }

    const removeResult = await removeResponse.json();
    console.log('✅ Remove result:', JSON.stringify(removeResult, null, 2));

    console.log('\n🎉 All high-level tool tests completed successfully!');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    process.exit(1);
  }
}

// Run the test
testHighLevelTools(); 