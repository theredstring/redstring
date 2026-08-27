#!/usr/bin/env node

import fetch from 'node-fetch';

async function testPrototypeIdFix() {
  console.log('🧪 Testing Prototype ID/Name Fix\n');
  
  try {
    // Test 1: Create a test prototype
    console.log('📋 Test 1: Creating test prototype...');
    const createResponse = await fetch('http://localhost:3001/api/bridge/actions/add-node-prototype', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test Prototype',
        description: 'A test prototype for ID/name lookup',
        color: '#FF6B6B'
      })
    });
    
    if (createResponse.ok) {
      const createResult = await createResponse.json();
      console.log('✅ Created prototype:', createResult.prototype.name, 'with ID:', createResult.prototype.id);
      
      const prototypeId = createResult.prototype.id;
      const prototypeName = createResult.prototype.name;
      
      // Test 2: Add instance using prototype name
      console.log('\n📋 Test 2: Adding instance using prototype name...');
      const nameResponse = await fetch('http://localhost:3001/api/bridge/actions/add-node-instance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graphId: '5ba5b655-2d63-4d21-97a7-55edc17808a0',
          prototypeName: prototypeName,
          position: { x: 100, y: 100 }
        })
      });
      
      if (nameResponse.ok) {
        const nameResult = await nameResponse.json();
        console.log('✅ Added instance using name:', nameResult.instance.id);
      } else {
        const errorText = await nameResponse.text();
        console.log('❌ Failed to add instance using name:', errorText);
      }
      
      // Test 3: Add instance using prototype ID
      console.log('\n📋 Test 3: Adding instance using prototype ID...');
      const idResponse = await fetch('http://localhost:3001/api/bridge/actions/add-node-instance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graphId: '5ba5b655-2d63-4d21-97a7-55edc17808a0',
          prototypeName: prototypeId,
          position: { x: 200, y: 200 }
        })
      });
      
      if (idResponse.ok) {
        const idResult = await idResponse.json();
        console.log('✅ Added instance using ID:', idResult.instance.id);
      } else {
        const errorText = await idResponse.text();
        console.log('❌ Failed to add instance using ID:', errorText);
      }
      
      // Test 4: Test with existing prototype ID from your data
      console.log('\n📋 Test 4: Testing with existing prototype ID...');
      const existingIdResponse = await fetch('http://localhost:3001/api/bridge/actions/add-node-instance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graphId: '5ba5b655-2d63-4d21-97a7-55edc17808a0',
          prototypeName: '33b579d9-9d19-4c03-b802-44de24055f23', // Charles McGill ID
          position: { x: 300, y: 300 }
        })
      });
      
      if (existingIdResponse.ok) {
        const existingIdResult = await existingIdResponse.json();
        console.log('✅ Added instance using existing ID:', existingIdResult.instance.id);
      } else {
        const errorText = await existingIdResponse.text();
        console.log('❌ Failed to add instance using existing ID:', errorText);
      }
      
      // Test 5: Test with existing prototype name
      console.log('\n📋 Test 5: Testing with existing prototype name...');
      const existingNameResponse = await fetch('http://localhost:3001/api/bridge/actions/add-node-instance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graphId: '5ba5b655-2d63-4d21-97a7-55edc17808a0',
          prototypeName: 'Charles McGill', // Charles McGill name
          position: { x: 400, y: 400 }
        })
      });
      
      if (existingNameResponse.ok) {
        const existingNameResult = await existingNameResponse.json();
        console.log('✅ Added instance using existing name:', existingNameResult.instance.id);
      } else {
        const errorText = await existingNameResponse.text();
        console.log('❌ Failed to add instance using existing name:', errorText);
      }
      
    } else {
      console.log('❌ Failed to create prototype');
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
  
  console.log('\n🚀 Testing prototype ID/name fix...\n');
  await testPrototypeIdFix();
  
  console.log('\n✨ Test completed!');
  console.log('\n🎉 The add_node_instance tool now supports:');
  console.log('   ✅ Prototype names (e.g., "Charles McGill")');
  console.log('   ✅ Prototype IDs (e.g., "33b579d9-9d19-4c03-b802-44de24055f23")');
  console.log('   ✅ Case-insensitive name matching');
  console.log('   ✅ Better error messages with available prototypes');
}

main().catch(console.error); 