import fetch from 'node-fetch';

// Test the execution of the new tools via the Bridge Server API
// This mimics how an MCP client would send the actions
async function runTests() {
  const BRIDGE_PORT = 3001;
  const baseUrl = `http://localhost:${BRIDGE_PORT}/api/bridge/pending-actions/enqueue`;

  async function enqueueAction(action, params = []) {
    const payload = { action, params };
    console.log(`\n--- Testing ${action} ---`);
    console.log(`Sending payload:`, payload);
    try {
      const res = await fetch(baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actions: [payload] })
      });
      const data = await res.json();
      console.log('Response:', data);
      return data;
    } catch (e) {
      console.error('Error:', e.message);
      return null;
    }
  }

  // 1. Check status
  await enqueueAction('getWizardStatus');

  // 2. Check tabs
  await enqueueAction('getWizardTabs');

  // 3. Create a tab
  await enqueueAction('createWizardTab');

  // Wait for React to process tab creation
  await new Promise(resolve => setTimeout(resolve, 1000));

  // 4. Send a message
  await enqueueAction('sendWizardMessage', ['Hello from the automated test script!']);

  console.log('\n--- Test suite complete! Check the UI and bridge server logs ---');
}

runTests();
