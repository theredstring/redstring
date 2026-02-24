// Using global fetch (available in Node 18+)

const MCP_PORT = 3003;
const BRIDGE_PORT = 3001;
const HOST = '127.0.0.1';

async function testPropagation() {
    console.log('🚀 Starting end-to-end propagation test...');

    try {
        const mcpUrl = `http://${HOST}:${MCP_PORT}/api/mcp/request`;

        // 1. Initialize MCP (List Tools)
        console.log('\n1. Checking MCP server tools via JSON-RPC...');
        const listRes = await fetch(mcpUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 'list-1',
                method: 'tools/list',
                params: {}
            })
        });

        if (!listRes.ok) throw new Error(`MCP server not reachable at ${mcpUrl}`);
        const listData = await listRes.json();
        const tools = listData.result?.tools || [];
        console.log(`Found ${tools.length} tools.`);

        // 2. Call create_populated_graph
        console.log('\n2. Calling create_populated_graph via MCP...');
        const callRes = await fetch(mcpUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 'call-1',
                method: 'tools/call',
                params: {
                    name: 'create_populated_graph',
                    arguments: {
                        nodes: [
                            { name: 'Propagation Test Node 1', color: '#FF5733', description: 'Testing fix' },
                            { name: 'Propagation Test Node 2', color: '#33FF green', description: 'Testing fix' }
                        ],
                        edges: [
                            { source: 'Propagation Test Node 1', target: 'Propagation Test Node 2', type: 'connected' }
                        ],
                        name: 'E2E Propagation Test Graph'
                    }
                }
            })
        });

        if (!callRes.ok) {
            const errorText = await callRes.text();
            throw new Error(`Tool call failed: ${errorText}`);
        }

        const callData = await callRes.json();
        console.log('Tool call returned successfully.');
        console.log('Result payload:', JSON.stringify(callData.result, null, 2));

        // 3. Check bridge pending actions (simulation of UI checking)
        console.log('\n3. Checking bridge for enqueued action...');
        const pendingRes = await fetch(`http://${HOST}:${BRIDGE_PORT}/api/bridge/pending-actions`);
        if (pendingRes.ok) {
            const pending = await pendingRes.json();
            // Look for createPopulatedGraph in the bridge queue
            const action = (pending.pending || []).find(a => a.action === 'createPopulatedGraph');
            if (action) {
                console.log('✅ Found correctly structured action in bridge queue!');
                console.log('Action details:', JSON.stringify(action, null, 2));

                // CRITICAL: Check if params[0] is our result object
                if (action.params && action.params[0] && action.params[0].action === 'createPopulatedGraph') {
                    console.log('✅ Payload structure verified: params[0] contains the result object.');
                } else {
                    console.warn('⚠️ Payload structure mismatch in bridge queue!');
                }
            } else {
                console.warn('⚠️ Action "createPopulatedGraph" not found in bridge queue. It might have been already consumed by the UI.');
            }
        } else {
            console.warn('⚠️ Could not reach bridge at 3001 to verify queue.');
        }

        console.log('\n🎉 Test completed. Please check the browser UI to confirm the graph "E2E Propagation Test Graph" exists.');

    } catch (error) {
        console.error('❌ Test failed:', error.message);
    }
}

testPropagation();
