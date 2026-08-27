#!/usr/bin/env node

import fetch from 'node-fetch';

async function testAddInstance() {
  console.log('🧪 Testing add_node_instance fix...\n');
  
  try {
    // First, let's check what prototypes are available
    console.log('📋 Checking available prototypes...');
    const stateResponse = await fetch('http://localhost:3001/api/bridge/state');
    if (stateResponse.ok) {
      const state = await stateResponse.json();
      console.log(`✅ Found ${state.nodePrototypes?.length || 0} prototypes`);
      
      if (state.nodePrototypes?.length > 0) {
        const firstPrototype = state.nodePrototypes[0];
        console.log(`📝 Using prototype: "${firstPrototype.name}"`);
        
        // Test adding an instance
        console.log('\n🔧 Testing add_node_instance...');
        const addInstanceResponse = await fetch('http://localhost:3001/api/bridge/actions/add-node-instance', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            graphId: state.activeGraphId || state.graphs?.[0]?.id,
            prototypeName: firstPrototype.name,
            position: { x: 200, y: 200 }
          })
        });
        
        if (addInstanceResponse.ok) {
          const result = await addInstanceResponse.json();
          console.log('✅ Instance added successfully:', result);
        } else {
          const errorText = await addInstanceResponse.text();
          console.log('❌ Failed to add instance:', errorText);
        }
      } else {
        console.log('⚠️ No prototypes available. Creating one first...');
        
        // Create a test prototype first
        const createPrototypeResponse = await fetch('http://localhost:3001/api/bridge/actions/add-node-prototype', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'Test Prototype',
            description: 'A test prototype for instance creation',
            color: '#FF6B6B'
          })
        });
        
        if (createPrototypeResponse.ok) {
          console.log('✅ Created test prototype');
          
          // Now try adding an instance
          const stateResponse2 = await fetch('http://localhost:3001/api/bridge/state');
          if (stateResponse2.ok) {
            const state2 = await stateResponse2.json();
            const newPrototype = state2.nodePrototypes?.find(p => p.name === 'Test Prototype');
            
            if (newPrototype) {
              console.log('🔧 Testing add_node_instance with new prototype...');
              const addInstanceResponse = await fetch('http://localhost:3001/api/bridge/actions/add-node-instance', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  graphId: state2.activeGraphId || state2.graphs?.[0]?.id,
                  prototypeName: newPrototype.name,
                  position: { x: 200, y: 200 }
                })
              });
              
              if (addInstanceResponse.ok) {
                const result = await addInstanceResponse.json();
                console.log('✅ Instance added successfully:', result);
              } else {
                const errorText = await addInstanceResponse.text();
                console.log('❌ Failed to add instance:', errorText);
              }
            }
          }
        }
      }
    } else {
      console.log('❌ Failed to get bridge state');
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
      console.log('✅ Bridge is running');
      return true;
    } else {
      console.log('❌ Bridge is not running');
      return false;
    }
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
    return;
  }
  
  console.log('\n🚀 Testing add_node_instance fix...\n');
  await testAddInstance();
  
  console.log('\n✨ Test completed!');
}

main().catch(console.error); 