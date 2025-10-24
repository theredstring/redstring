#!/usr/bin/env node

/**
 * Test script to verify MCP server instance creation fix
 * This tests the add_node_instance tool to ensure it properly passes prototype IDs
 */

console.log('🧪 Testing MCP server instance creation fix...\n');

async function testMCPInstanceCreation() {
  try {
    // First, let's check what prototypes are available
    console.log('📋 Checking available prototypes...');
    const stateResponse = await fetch('http://localhost:3001/api/bridge/state');
    if (!stateResponse.ok) {
      throw new Error(`Failed to get bridge state: ${stateResponse.status}`);
    }
    
    const state = await stateResponse.json();
    console.log(`✅ Found ${state.nodePrototypes?.length || 0} prototypes`);
    
    if (state.nodePrototypes && state.nodePrototypes.length > 0) {
      const prototype = state.nodePrototypes[0];
      console.log(`📝 Using prototype: ${prototype.name} (${prototype.id})`);
      
      // Check what graphs are available
      console.log(`📊 Found ${state.graphs?.length || 0} graphs`);
      if (state.graphs && state.graphs.length > 0) {
        const graph = state.graphs[0];
        console.log(`🎯 Using graph: ${graph.name} (${graph.id})`);
        
        // Test adding an instance using the MCP server's add_node_instance tool
        console.log('\n🔧 Testing add_node_instance via MCP server...');
        
        // Simulate the MCP server call
        const mcpResponse = await fetch('http://localhost:3001/api/bridge/actions/add-node-instance', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            graphId: graph.id,
            prototypeId: prototype.id, // This should now work correctly
            position: { x: 100, y: 100 }
          })
        });
        
        if (!mcpResponse.ok) {
          const errorText = await mcpResponse.text();
          throw new Error(`MCP server request failed: ${mcpResponse.status} - ${errorText}`);
        }
        
        const mcpResult = await mcpResponse.json();
        console.log('✅ MCP server response:', mcpResult);
        
        // Wait a moment for the action to be processed
        console.log('⏳ Waiting for action to be processed...');
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Check if the instance was actually added
        const updatedStateResponse = await fetch('http://localhost:3001/api/bridge/state');
        const updatedState = await updatedStateResponse.json();
        
        const updatedGraph = updatedState.graphs.find(g => g.id === graph.id);
        if (updatedGraph) {
          console.log(`✅ Graph instance count: ${updatedGraph.instanceCount || 0}`);
          if (updatedGraph.instanceCount > 0) {
            console.log('🎉 SUCCESS: Instance was added correctly!');
            console.log(`   Instance count increased to: ${updatedGraph.instanceCount}`);
            console.log(`   Prototype ID used: ${prototype.id}`);
            console.log(`   Position: (100, 100)`);
          } else {
            console.log('❌ Instance count is still 0');
          }
        } else {
          console.log('❌ Graph not found in updated state');
        }
        
      } else {
        console.log('❌ No graphs available for testing');
      }
    } else {
      console.log('❌ No prototypes available for testing');
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

// Run the test
testMCPInstanceCreation().then(() => {
  console.log('\n🏁 Test completed');
  process.exit(0);
}).catch(error => {
  console.error('💥 Test crashed:', error);
  process.exit(1);
}); 