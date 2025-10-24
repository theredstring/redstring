#!/usr/bin/env node

/**
 * Test script for AI-Guided Workflow
 * Demonstrates the complete workflow of creating a prototype, definition, and adding instances
 */

import fetch from 'node-fetch';

async function testAIWorkflow() {
  console.log('🤖 Testing AI-Guided Workflow\n');
  
  try {
    // Test 1: Create a prototype and definition
    console.log('📋 Test 1: Creating prototype and definition...');
    const workflow1 = await fetch('http://localhost:3001/api/bridge/actions/ai-guided-workflow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workflowType: 'create_prototype_and_definition',
        prototypeName: 'AI Workflow Test',
        prototypeDescription: 'Testing the AI-guided workflow system',
        prototypeColor: '#FF6B6B',
        enableUserGuidance: true
      })
    });
    
    if (workflow1.ok) {
      const result1 = await workflow1.json();
      console.log('✅ Workflow 1 completed:', result1);
    } else {
      console.log('❌ Workflow 1 failed:', await workflow1.text());
    }
    
    // Test 2: Full workflow with instances
    console.log('\n📋 Test 2: Full workflow with instances...');
    const workflow2 = await fetch('http://localhost:3001/api/bridge/actions/ai-guided-workflow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workflowType: 'full_workflow',
        prototypeName: 'Complete System',
        prototypeDescription: 'A complete system with multiple components',
        prototypeColor: '#4ECDC4',
        instancePositions: [
          { prototypeName: 'Component A', x: 100, y: 100 },
          { prototypeName: 'Component B', x: 300, y: 100 },
          { prototypeName: 'Component C', x: 200, y: 300 }
        ],
        connections: [
          { sourceName: 'Component A', targetName: 'Component B', edgeType: 'depends_on' },
          { sourceName: 'Component B', targetName: 'Component C', edgeType: 'provides_to' }
        ],
        enableUserGuidance: true
      })
    });
    
    if (workflow2.ok) {
      const result2 = await workflow2.json();
      console.log('✅ Workflow 2 completed:', result2);
    } else {
      console.log('❌ Workflow 2 failed:', await workflow2.text());
    }
    
    // Test 3: Add instances to existing graph
    console.log('\n📋 Test 3: Adding instances to existing graph...');
    const workflow3 = await fetch('http://localhost:3001/api/bridge/actions/ai-guided-workflow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workflowType: 'add_instance_to_graph',
        targetGraphId: '5ba5b655-2d63-4d21-97a7-55edc17808a0', // Better Call Saul graph
        instancePositions: [
          { prototypeName: 'New Character', x: 150, y: 150 },
          { prototypeName: 'New Location', x: 350, y: 250 }
        ],
        enableUserGuidance: true
      })
    });
    
    if (workflow3.ok) {
      const result3 = await workflow3.json();
      console.log('✅ Workflow 3 completed:', result3);
    } else {
      console.log('❌ Workflow 3 failed:', await workflow3.text());
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

// Check if services are running
async function checkServices() {
  try {
    const bridgeResponse = await fetch('http://localhost:3001/api/bridge/state');
    if (bridgeResponse.ok) {
      const state = await bridgeResponse.json();
      console.log('✅ Bridge is running');
      console.log(`   📊 Found ${state.graphs?.length || 0} graphs and ${state.nodePrototypes?.length || 0} prototypes`);
    } else {
      console.log('❌ Bridge is not running');
      return false;
    }
    
    return true;
  } catch (error) {
    console.log('❌ Cannot connect to bridge:', error.message);
    return false;
  }
}

async function main() {
  console.log('🔍 Checking services...');
  const servicesOk = await checkServices();
  
  if (!servicesOk) {
    console.log('\n❌ Services not ready. Please ensure:');
    console.log('   1. Bridge server is running (npm run server)');
    console.log('   2. MCP server is running (node redstring-mcp-server.js)');
    console.log('   3. Redstring UI is running');
    return;
  }
  
  console.log('\n🚀 Starting AI workflow tests...\n');
  await testAIWorkflow();
  
  console.log('\n✨ Test completed!');
}

main().catch(console.error); 