import fetch from 'node-fetch';
import fs from 'fs';

const BRIDGE_URL = process.env.BRIDGE_URL || 'http://localhost:3001';
const API_KEY = process.env.API_KEY || '';
const MODEL = process.env.MODEL || 'openai/gpt-5.1-chat';

async function chat(message) {
  console.log(`\n👤 User: ${message}`);
  
  // Fetch latest state to provide context
  let latestState = {};
  try {
    const stateRes = await fetch(`${BRIDGE_URL}/api/bridge/state`);
    latestState = await stateRes.json();
  } catch (e) {
    // Fallback ok
  }

  const response = await fetch(`${BRIDGE_URL}/api/ai/agent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`
    },
    body: JSON.stringify({
      message,
      context: {
        apiConfig: { model: MODEL, provider: 'openrouter' },
        activeGraphId: latestState.activeGraphId,
        graphs: latestState.graphs,
        nodePrototypes: latestState.nodePrototypes
      }
    })
  });
  
  const data = await response.json();
  console.log(`\n🧙‍♂️ Wizard: ${data.response}`);
  
  // Semantic failure check
  const text = (data.response || '').toLowerCase();
  const failureIndicators = ['could not find', 'couldn\'t find', 'error', 'not found', 'failed', 'missing'];
  const failed = failureIndicators.some(ind => text.includes(ind));
  
  if (failed) {
    console.log(`\n⚠️  The Wizard reported a problem. Check the context or IDs.`);
  }

  if (data.goalId) {
    console.log(`\n🎯 Goal Queued: ${data.goalId}`);
    await waitForGoal(data.goalId);
  }
  
  if (data.toolCalls && data.toolCalls.length > 0) {
    console.log('\n🛠 Tool Calls:');
    data.toolCalls.forEach(tc => {
      console.log(`  - ${tc.name} (${tc.status})`);
    });
  }
}

async function waitForGoal(goalId, timeout = 30000) {
  console.log(`⌛ Processing...`);
  const start = Date.now();
  let lastTraces = 0;
  
  while (Date.now() - start < timeout) {
    try {
      const res = await fetch(`${BRIDGE_URL}/api/bridge/debug/traces`);
      const data = await res.json();
      const traces = data.traces || [];
      const myTrace = traces.find(t => t.cid === goalId || t.id === goalId);
      
      if (myTrace) {
        const stages = Object.keys(myTrace.stages || {});
        if (stages.length > lastTraces) {
          console.log(`  ✨ Progress: ${stages.join(' → ')}`);
          lastTraces = stages.length;
        }
        
        if (myTrace.status === 'success' || myTrace.status === 'completed') {
          console.log(`✅ Operation completed successfully!`);
          return true;
        }
        if (myTrace.status === 'error') {
          console.log(`❌ Operation failed: ${myTrace.error}`);
          return false;
        }
      }
    } catch (e) {
      // API might be down or starting
    }
    
    // Check pending actions as fallback
    const pendingRes = await fetch(`${BRIDGE_URL}/api/bridge/pending-actions`);
    const pendingData = await pendingRes.json();
    if (pendingData.pendingActions?.length === 0 && lastTraces > 0) {
       console.log(`✅ Actions processed.`);
       return true;
    }
    
    await new Promise(r => setTimeout(r, 1000));
  }
  console.log(`\n⚠️ Timeout waiting for goal ${goalId}`);
  return false;
}

const message = process.argv.slice(2).join(' ');
if (!message) {
  console.log('Usage: API_KEY=... node test/ai/interactive-wizard.js "Your message here"');
  process.exit(1);
}

chat(message).catch(console.error);
