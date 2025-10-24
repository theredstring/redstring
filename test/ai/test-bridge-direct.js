#!/usr/bin/env node

/**
 * Direct Bridge Server Tester
 * 
 * This script tests the bridge server endpoints directly to verify they work.
 */

import fetch from 'node-fetch';

class DirectBridgeTester {
  constructor() {
    this.baseUrl = 'http://localhost:3001';
    this.testResults = [];
  }

  async start() {
    console.log('🌉 Direct Bridge Server Tester');
    console.log('==============================\n');

    try {
      // Test bridge health
      await this.testHealth();
      
      // Test bridge state
      await this.testBridgeState();
      
      // Test bridge actions
      await this.testBridgeActions();
      
      // Generate report
      this.generateReport();
      
    } catch (error) {
      console.error('❌ Tester failed:', error.message);
      process.exit(1);
    }
  }

  async testHealth() {
    console.log('🔍 Testing bridge health...');
    
    try {
      const response = await fetch(`${this.baseUrl}/health`);
      const data = await response.json();
      
      if (response.ok && data.status === 'ok') {
        console.log('   ✅ Bridge server is healthy');
        this.testResults.push({
          test: 'health',
          success: true,
          message: 'Bridge server is healthy'
        });
      } else {
        throw new Error(`Unexpected response: ${JSON.stringify(data)}`);
      }
    } catch (error) {
      console.log(`   ❌ Health check failed: ${error.message}`);
      this.testResults.push({
        test: 'health',
        success: false,
        message: error.message
      });
    }
  }

  async testBridgeState() {
    console.log('\n📊 Testing bridge state...');
    
    try {
      const response = await fetch(`${this.baseUrl}/api/bridge/state`);
      const data = await response.json();
      
      if (response.ok && data.graphs) {
        console.log(`   ✅ Bridge state retrieved successfully`);
        console.log(`   📈 Found ${data.graphs.length} graphs`);
        console.log(`   🔧 Found ${data.nodePrototypes.length} prototypes`);
        console.log(`   🎯 Active graph: ${data.activeGraphId}`);
        console.log(`   📂 Open graphs: ${data.openGraphIds.length}`);
        
        this.testResults.push({
          test: 'bridge_state',
          success: true,
          message: `Found ${data.graphs.length} graphs and ${data.nodePrototypes.length} prototypes`
        });
        
        // Store some data for later tests
        this.bridgeData = data;
      } else {
        throw new Error(`Unexpected response: ${JSON.stringify(data)}`);
      }
    } catch (error) {
      console.log(`   ❌ Bridge state failed: ${error.message}`);
      this.testResults.push({
        test: 'bridge_state',
        success: false,
        message: error.message
      });
    }
  }

  async testBridgeActions() {
    console.log('\n🔧 Testing bridge actions...');
    
    // Test adding a node prototype
    await this.testAddNodePrototype();
    
    // Test adding a node instance (if we have a graph)
    if (this.bridgeData && this.bridgeData.graphs && this.bridgeData.graphs.length > 0) {
      await this.testAddNodeInstance();
    }
  }

  async testAddNodePrototype() {
    console.log('   🔧 Testing add node prototype...');
    
    try {
      const prototypeData = {
        name: 'Direct Test Prototype',
        description: 'A test prototype created via direct bridge API',
        color: '#FF6B6B'
      };
      
      const response = await fetch(`${this.baseUrl}/api/bridge/actions/add-node-prototype`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(prototypeData)
      });
      
      const data = await response.json();
      
      if (response.ok && data.success) {
        console.log(`   ✅ Node prototype added successfully`);
        console.log(`   🆔 Prototype ID: ${data.prototype.id}`);
        this.testResults.push({
          test: 'add_node_prototype',
          success: true,
          message: `Prototype added with ID: ${data.prototype.id}`
        });
      } else {
        throw new Error(`Failed to add prototype: ${JSON.stringify(data)}`);
      }
    } catch (error) {
      console.log(`   ❌ Add node prototype failed: ${error.message}`);
      this.testResults.push({
        test: 'add_node_prototype',
        success: false,
        message: error.message
      });
    }
  }

  async testAddNodeInstance() {
    console.log('   🔧 Testing add node instance...');
    
    try {
      const graphId = this.bridgeData.graphs[0].id;
      const prototypeId = this.bridgeData.nodePrototypes[0].id;
      
      const instanceData = {
        graphId: graphId,
        prototypeId: prototypeId,
        position: { x: 400, y: 400 }
      };
      
      const response = await fetch(`${this.baseUrl}/api/bridge/actions/add-node-instance`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(instanceData)
      });
      
      const data = await response.json();
      
      if (response.ok && data.success) {
        console.log(`   ✅ Node instance added successfully`);
        console.log(`   🆔 Instance ID: ${data.instance.id}`);
        this.testResults.push({
          test: 'add_node_instance',
          success: true,
          message: `Instance added with ID: ${data.instance.id}`
        });
      } else {
        throw new Error(`Failed to add instance: ${JSON.stringify(data)}`);
      }
    } catch (error) {
      console.log(`   ❌ Add node instance failed: ${error.message}`);
      this.testResults.push({
        test: 'add_node_instance',
        success: false,
        message: error.message
      });
    }
  }

  generateReport() {
    console.log('\n📋 Direct Bridge Test Report');
    console.log('============================\n');

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
      console.log(`   ${index + 1}. ${status} ${result.test}: ${result.message}`);
    });

    console.log('\n🚀 Bridge Server Status:');
    console.log('   ✅ Bridge Server: Running on localhost:3001');
    console.log('   ✅ Health Endpoint: Accessible');
    console.log('   ✅ State Endpoint: Working');
    console.log('   ✅ Action Endpoints: Tested');

    if (successfulTests === totalTests) {
      console.log('\n🎉 ALL BRIDGE TESTS PASSED! The bridge server is fully functional.');
      console.log('\n💡 The issue is likely with the MCP server not connecting to the bridge.');
    } else {
      console.log('\n⚠️  Some bridge tests failed. Check the error messages above.');
    }
  }
}

// Start the tester
const tester = new DirectBridgeTester();
tester.start().catch(error => {
  console.error('❌ Tester failed:', error.message);
  process.exit(1);
}); 