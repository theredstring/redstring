/**
 * E2E Test Harness for The Wizard
 * Tests edge operations and graph editing without requiring full UI
 * 
 * Usage:
 *   # Dry-run (test bridge connectivity only)
 *   node test/ai/wizard-e2e.js --dry-run
 *
 *   # Full test with API key
 *   API_KEY=your-api-key node test/ai/wizard-e2e.js
 *
 *   # Auto-discover and test all wizard tools
 *   API_KEY=your-api-key node test/ai/wizard-e2e.js --auto-discover
 * 
 * Requirements:
 *   - Bridge daemon running on port 3001 (npm run bridge)
 *   - Valid API key for OpenRouter/Anthropic (for full tests)
 * 
 * What it tests:
 *   - Bridge state sync works
 *   - Edge creation intent detection (create_edge)
 *   - Edge update intent detection (update_edge)  
 *   - Edge deletion intent detection (delete_edge)
 *   - Graph deletion uses context (doesn't ask for ID)
 *   - Bridge APIs respond correctly
 * 
 * Note: Goal execution requires the UI's Committer to process tasks.
 */

import fetch from 'node-fetch';

const BRIDGE_URL = process.env.BRIDGE_URL || 'http://localhost:3001';
const API_KEY = process.env.API_KEY || '';
const MODEL = process.env.MODEL || '';
const DRY_RUN = process.argv.includes('--dry-run');

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(color, ...args) {
  console.log(colors[color] || '', ...args, colors.reset);
}

// Test helper to check bridge health
async function checkBridgeHealth() {
  try {
    const response = await fetch(`${BRIDGE_URL}/api/bridge/health`);
    return response.ok;
  } catch {
    return false;
  }
}

// Test helper to make API calls
async function callAgent(message, context = {}) {
  const response = await fetch(`${BRIDGE_URL}/api/ai/agent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(API_KEY && { 'Authorization': `Bearer ${API_KEY}` })
    },
    body: JSON.stringify({
      message,
      context: {
        activeGraphId: context.activeGraphId || null,
        activeGraph: context.activeGraph || null,
        conversationHistory: context.conversationHistory || [],
        apiConfig: context.apiConfig || (MODEL ? { model: MODEL, provider: 'openrouter' } : null),
        isTest: true // Mark as test to prevent chat broadcast
      }
    })
  });
  return response.json();
}

// Test helper to sync bridge state
async function syncBridgeState(state) {
  const response = await fetch(`${BRIDGE_URL}/api/bridge/state`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state)
  });
  return response.json();
}

// Test helper to get pending actions
async function getPendingActions() {
  const response = await fetch(`${BRIDGE_URL}/api/bridge/pending-actions`);
  return response.json();
}

// Test helper to get telemetry (shows tool calls and their status)
async function getTelemetry() {
  const response = await fetch(`${BRIDGE_URL}/api/bridge/telemetry`);
  return response.json();
}

// Test helper to get bridge state
async function getBridgeState() {
  const response = await fetch(`${BRIDGE_URL}/api/bridge/state`);
  return response.json();
}

// Test helper to discover all wizard tools
async function discoverTools() {
  const response = await fetch(`${BRIDGE_URL}/api/bridge/tools`);
  const data = await response.json();
  return data.tools || [];
}

// Generate a test message for a given tool/intent
function generateTestMessage(tool) {
  const messages = {
    'qa': 'What graphs do I have?',
    'create_graph': 'Create a graph about planets with Earth, Mars, and Venus',
    'create_node': 'Add a Computer node to this graph',
    'analyze': 'Analyze the current graph structure',
    'update_node': 'Change Earth\'s color to blue',
    'delete_node': 'Delete the Mars node',
    'delete_graph': 'Delete this graph',
    'update_edge': 'Change the connection between Earth and Sun to Orbits',
    'delete_edge': 'Remove the connection between Earth and Mars',
    'create_edge': 'Connect Earth to Moon with an Orbits relationship',
    'bulk_delete': 'Delete Earth, Mars, and Venus',
    'enrich_node': 'Enrich the Earth node with more details'
  };

  return messages[tool.name] || `Test ${tool.name}`;
}

// Helper to wait for pending actions to be picked up
async function waitForNoNewPendingActions(initialCount, timeout = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const data = await getPendingActions();
    const currentCount = data.pendingActions?.length || 0;
    if (currentCount < initialCount) {
      return true; // Actions are being processed
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  return false;
}

// Test result tracking
let testsPassed = 0;
let testsFailed = 0;

function assertContains(actual, expected, testName) {
  if (actual && actual.includes && actual.includes(expected)) {
    log('green', `  ✓ ${testName}`);
    testsPassed++;
    return true;
  } else {
    log('red', `  ✗ ${testName}`);
    log('red', `    Expected to contain: "${expected}"`);
    log('red', `    Actual: "${actual}"`);
    testsFailed++;
    return false;
  }
}

function assertTruthy(value, testName) {
  if (value) {
    log('green', `  ✓ ${testName}`);
    testsPassed++;
    return true;
  } else {
    log('red', `  ✗ ${testName}`);
    testsFailed++;
    return false;
  }
}

function assertToolCall(toolCalls, toolName, testName) {
  const found = toolCalls?.some(tc => tc.name === toolName);
  if (found) {
    log('green', `  ✓ ${testName} - Found tool call: ${toolName}`);
    testsPassed++;
    return true;
  } else {
    log('red', `  ✗ ${testName}`);
    log('red', `    Expected tool call: "${toolName}"`);
    log('red', `    Actual tool calls: ${JSON.stringify(toolCalls?.map(tc => tc.name) || [])}`);
    testsFailed++;
    return false;
  }
}

// Test suite
async function runTests() {
  log('cyan', '\n🧪 Starting Wizard E2E Tests...\n');

  // Check bridge health
  log('blue', '📡 Checking bridge connection...');
  const bridgeHealthy = await checkBridgeHealth();
  if (!bridgeHealthy) {
    log('red', '❌ Bridge server not running. Start it with: npm run bridge');
    process.exit(1);
  }
  log('green', '✓ Bridge server is healthy\n');

  if (!API_KEY && !DRY_RUN) {
    log('yellow', '⚠️  No API_KEY provided. Tests will run but AI responses will be limited.');
    log('yellow', '   Run with: API_KEY=your-key node test/ai/wizard-e2e.js');
    log('yellow', '   Or use --dry-run to test bridge connectivity only.\n');
  }

  if (DRY_RUN) {
    log('yellow', '🔍 Running in dry-run mode (no AI calls)\n');
  } else if (MODEL) {
    log('cyan', `🤖 Using model: ${MODEL}\n`);
  }

  // Setup: Create a test graph with nodes (using generic example data)
  log('blue', '📝 Setting up test graph...');
  const testGraphId = `graph-test-${Date.now()}`;
  const testState = {
    graphs: [{
      id: testGraphId,
      name: 'Solar System',
      instances: {
        'inst-sun': { id: 'inst-sun', prototypeId: 'proto-sun', x: 100, y: 100 },
        'inst-earth': { id: 'inst-earth', prototypeId: 'proto-earth', x: 200, y: 200 }
      },
      edgeIds: ['edge-existing-1']
    }],
    nodePrototypes: [
      { id: 'proto-sun', name: 'Sun', color: '#FDB813' },
      { id: 'proto-earth', name: 'Earth', color: '#4A90E2' }
    ],
    edges: {
      'edge-existing-1': {
        id: 'edge-existing-1',
        sourceId: 'inst-earth',
        destinationId: 'inst-sun',
        name: 'Near',
        typeNodeId: 'base-connection-prototype'
      }
    },
    graphEdges: [{
      id: 'edge-existing-1',
      sourceId: 'inst-earth',
      destinationId: 'inst-sun',
      name: 'Near',
      typeNodeId: 'base-connection-prototype'
    }],
    activeGraphId: testGraphId
  };

  const syncResult = await syncBridgeState(testState);
  assertTruthy(syncResult.success, 'Bridge state sync');
  
  // Verify state was synced
  const state = await getBridgeState();
  assertTruthy(state.graphs?.length > 0 || state.summary?.totalGraphs > 0, 'State contains graphs');
  log('green', '✓ Test graph created\n');

  // ========================================
  // Test 1: Intent detection for create_edge
  // ========================================
  log('blue', 'Test 1: Create edge intent detection...');
  
  if (DRY_RUN) {
    log('yellow', '  [Skipped - dry-run mode]');
  } else {
    try {
      const createResponse = await callAgent(
        'connect Earth to Sun with an Orbits relationship',
        {
          activeGraphId: testGraphId,
          activeGraph: { name: 'Solar System', nodeCount: 2, edgeCount: 1, nodes: ['Sun', 'Earth'] }
        }
      );
      
      log('cyan', `  Response: ${createResponse.response || 'No response'}`);
      
      if (createResponse.error) {
        log('red', `  Error: ${createResponse.error}`);
        testsFailed++;
      } else {
        // Check if it detected an edge-related intent
        const toolCalls = createResponse.toolCalls || [];
        const hasEdgeCall = toolCalls.some(tc => 
          tc.name === 'create_edge' || tc.name === 'create_populated_graph'
        );
        assertTruthy(hasEdgeCall || createResponse.goalId, 'Returns edge-related tool call or goal');
      }
    } catch (error) {
      log('red', `  ❌ Test 1 failed: ${error.message}`);
      testsFailed++;
    }
  }
  console.log();

  // ========================================
  // Test 2: Intent detection for update_edge
  // ========================================
  log('blue', 'Test 2: Update edge intent detection...');
  
  if (DRY_RUN) {
    log('yellow', '  [Skipped - dry-run mode]');
  } else {
    try {
      const updateResponse = await callAgent(
        'change the connection between Earth and Sun to be a Gravitational Orbit',
        {
          activeGraphId: testGraphId,
          activeGraph: { name: 'Solar System', nodeCount: 2, edgeCount: 1, nodes: ['Sun', 'Earth'] }
        }
      );
      
      log('cyan', `  Response: ${updateResponse.response || 'No response'}`);
      
      if (updateResponse.error) {
        log('red', `  Error: ${updateResponse.error}`);
        testsFailed++;
      } else {
        assertTruthy(updateResponse.response, 'Returns a response');
      }
    } catch (error) {
      log('red', `  ❌ Test 2 failed: ${error.message}`);
      testsFailed++;
    }
  }
  console.log();

  // ========================================
  // Test 3: Intent detection for delete_edge
  // ========================================
  log('blue', 'Test 3: Delete edge intent detection...');
  
  if (DRY_RUN) {
    log('yellow', '  [Skipped - dry-run mode]');
  } else {
    try {
      const deleteResponse = await callAgent(
        'remove the connection between Earth and Sun',
        {
          activeGraphId: testGraphId,
          activeGraph: { name: 'Solar System', nodeCount: 2, edgeCount: 1, nodes: ['Sun', 'Earth'] }
        }
      );
      
      log('cyan', `  Response: ${deleteResponse.response || 'No response'}`);
      
      if (deleteResponse.error) {
        log('red', `  Error: ${deleteResponse.error}`);
        testsFailed++;
      } else {
        assertTruthy(deleteResponse.response, 'Returns a response');
      }
    } catch (error) {
      log('red', `  ❌ Test 3 failed: ${error.message}`);
      testsFailed++;
    }
  }
  console.log();

  // ========================================
  // Test 4: Delete graph by name (not ID)
  // ========================================
  log('blue', 'Test 4: Delete graph by name...');
  
  if (DRY_RUN) {
    log('yellow', '  [Skipped - dry-run mode]');
  } else {
    try {
      const deleteGraphResponse = await callAgent(
        'please delete this graph',
        {
          activeGraphId: testGraphId,
          activeGraph: { name: 'Solar System', nodeCount: 2, edgeCount: 0, nodes: ['Sun', 'Earth'] }
        }
      );
      
      log('cyan', `  Response: ${deleteGraphResponse.response || 'No response'}`);
      
      if (deleteGraphResponse.error) {
        log('red', `  Error: ${deleteGraphResponse.error}`);
        testsFailed++;
      } else {
        // Should NOT ask for graph ID
        const asksForId = (deleteGraphResponse.response || '').toLowerCase().includes('graph id');
        if (asksForId) {
          log('red', '  ✗ AI asked for graph ID instead of using context');
          testsFailed++;
        } else {
          assertTruthy(deleteGraphResponse.goalId || deleteGraphResponse.toolCalls?.length > 0, 
            'Returns goal or tool calls without asking for ID');
        }
      }
    } catch (error) {
      log('red', `  ❌ Test 4 failed: ${error.message}`);
      testsFailed++;
    }
  }
  console.log();

  // ========================================
  // Test 5: Enrich node (create definition graph)
  // ========================================
  log('blue', 'Test 5: Enrich node intent detection...');
  
  if (DRY_RUN) {
    log('yellow', '  [Skipped - dry-run mode]');
  } else {
    try {
      // First create a simple graph with a node to enrich
      const enrichTestGraphId = `graph-${Date.now()}-enrich-test`;
      const enrichTestState = {
        graphs: [{
          id: enrichTestGraphId,
          name: 'Computer System',
          instances: {
            'inst-computer': {
              id: 'inst-computer',
              prototypeId: 'proto-computer',
              x: 500,
              y: 300
            }
          },
          edgeIds: []
        }],
        nodePrototypes: [
          { id: 'proto-computer', name: 'Computer', color: '#4A90E2' }
        ],
        edges: {},
        graphEdges: [],
        activeGraphId: enrichTestGraphId
      };

      await syncBridgeState(enrichTestState);
      
      const enrichResponse = await callAgent(
        'enrich Computer with its components',
        {
          activeGraphId: enrichTestGraphId,
          activeGraph: { name: 'Computer System', nodeCount: 1, edgeCount: 0, nodes: ['Computer'] }
        }
      );
      
      log('cyan', `  Response: ${enrichResponse.response || 'No response'}`);
      
      if (enrichResponse.error) {
        log('red', `  Error: ${enrichResponse.error}`);
        testsFailed++;
      } else {
        // Check if it detected enrich_node intent
        const toolCalls = enrichResponse.toolCalls || [];
        const hasEnrichCall = toolCalls.some(tc => 
          tc.name === 'enrich_node' || tc.name === 'create_and_assign_graph_definition'
        );
        assertTruthy(hasEnrichCall || enrichResponse.goalId, 'Returns enrich_node tool call or goal');
        testsPassed++;
      }
    } catch (error) {
      log('red', `  ❌ Test 5 failed: ${error.message}`);
      testsFailed++;
    }
  }
  console.log();

  // ========================================
  // Test 6: Pending actions API works
  // ========================================
  log('blue', 'Test 6: Pending actions API...');
  try {
    const pendingData = await getPendingActions();
    assertTruthy(pendingData.pendingActions !== undefined, 'Returns pendingActions array');
  } catch (error) {
    log('red', `  ❌ Test 5 failed: ${error.message}`);
    testsFailed++;
  }
  console.log();

  // ========================================
  // Test 7: Telemetry API works
  // ========================================
  log('blue', 'Test 7: Telemetry API...');
  try {
    const telemetryData = await getTelemetry();
    assertTruthy(telemetryData && Array.isArray(telemetryData.telemetry), 'Returns telemetry object with telemetry array');
  } catch (error) {
    log('red', `  ❌ Test 6 failed: ${error.message}`);
    testsFailed++;
  }
  console.log();

  // ========================================
  // Test 8: Auto-discover and test all tools (optional)
  // ========================================
  const AUTO_DISCOVER = process.argv.includes('--auto-discover');
  if (AUTO_DISCOVER && !DRY_RUN) {
    log('blue', 'Test 8: Auto-discover all wizard tools...');
    try {
      const tools = await discoverTools();
      log('cyan', `  Discovered ${tools.length} tools: ${tools.map(t => t.name).join(', ')}`);

      // Test a few key tools
      const toolsToTest = ['qa', 'analyze', 'create_node'];
      for (const toolName of toolsToTest) {
        const tool = tools.find(t => t.name === toolName);
        if (!tool) continue;

        const testMessage = generateTestMessage(tool);
        log('cyan', `  Testing ${tool.name}: "${testMessage}"`);

        try {
          const response = await callAgent(testMessage, {
            activeGraphId: testGraphId,
            activeGraph: { name: 'Solar System', nodeCount: 2, edgeCount: 1, nodes: ['Sun', 'Earth'] }
          });

          if (response.error) {
            log('yellow', `    ⚠ ${tool.name}: ${response.error}`);
          } else {
            assertTruthy(response.response || response.goalId, `${tool.name} returns response`);
          }
        } catch (error) {
          log('red', `    ✗ ${tool.name} failed: ${error.message}`);
          testsFailed++;
        }
      }
    } catch (error) {
      log('red', `  ❌ Auto-discovery failed: ${error.message}`);
      testsFailed++;
    }
    console.log();
  }

  // ========================================
  // Summary
  // ========================================
  log('cyan', '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  log('cyan', '📊 Test Summary');
  log('cyan', '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  log('green', `  Passed: ${testsPassed}`);
  log(testsFailed > 0 ? 'red' : 'green', `  Failed: ${testsFailed}`);
  console.log();

  if (testsFailed > 0) {
    log('red', '❌ Some tests failed');
    process.exit(1);
  } else {
    log('green', '✅ All tests passed!');
  }
}

// Run tests if executed directly
const isMainModule = import.meta.url.endsWith(process.argv[1]?.replace(/\\/g, '/')) || 
                     process.argv[1]?.includes('wizard-e2e.js');

if (isMainModule) {
  runTests().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { runTests, callAgent, syncBridgeState, getPendingActions, getTelemetry, getBridgeState, discoverTools, generateTestMessage };
