import http from 'http';
import process from 'process';

// Helper for making HTTP requests
function request(method, path, body = null, headers = {}) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port: 3001,
            path: path,
            method: method,
            headers: {
                'Content-Type': 'application/json',
                ...headers
            }
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    resolve(data); // Return raw text if not JSON
                }
            });
        });

        req.on('error', (e) => reject(e));
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

export async function runSimulation(prompt, apiKey) {
    const CID = `sim-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    console.log(`\n🤖 Starting Wizard Simulation`);
    console.log(`🆔 Conversation ID: ${CID}`);
    console.log(`📝 Prompt: "${prompt}"`);
    console.log('---------------------------------------------------\n');

    try {
        // 1. Get Initial State
        console.log('📊 Fetching initial graph state...');
        const initialState = await request('GET', '/api/bridge/state');
        const initialGraph = initialState.activeGraphId
            ? (Array.isArray(initialState.graphs) ? initialState.graphs.find(g => g.id === initialState.activeGraphId) : null)
            : null;

        const initialCounts = {
            nodes: initialGraph ? (initialGraph.instances ? Object.keys(initialGraph.instances).length : 0) : 0,
            edges: initialGraph ? (Array.isArray(initialGraph.edgeIds) ? initialGraph.edgeIds.length : 0) : 0
        };
        console.log(`   Initial State: ${initialCounts.nodes} nodes, ${initialCounts.edges} edges\n`);

        // 2. Send the user message
        console.log('📤 Sending request to Wizard...');
        await request('POST', '/api/ai/agent', {
            message: prompt,
            conversationHistory: [], // Start fresh
            cid: CID,
            apiConfig: {
                provider: 'openrouter',
                model: 'anthropic/claude-3.5-sonnet', // Default or make configurable
                apiKey: apiKey
            }
        }, {
            'Authorization': `Bearer ${apiKey}`
        });

        console.log('✅ Request sent. Listening for response...\n');

        // 3. Poll for updates
        const seenChatIds = new Set();
        const seenTelemetryIds = new Set();
        let isComplete = false;
        let pollCount = 0;
        const MAX_POLLS = 600; // 10 minutes (1s interval)
        let finalCounts = { ...initialCounts };
        let lastActivityTime = Date.now();
        const ACTIVITY_TIMEOUT_MS = 120000; // 2 minutes of no new messages = timeout

        while (!isComplete && pollCount < MAX_POLLS) {
            const data = await request('GET', '/api/bridge/telemetry');

            // Process Chat
            if (data.chat && Array.isArray(data.chat)) {
                const relevantChat = data.chat.filter(c => c.cid === CID);
                relevantChat.forEach(msg => {
                    const msgId = msg.ts + msg.text.substring(0, 10); // Simple dedup key
                    if (!seenChatIds.has(msgId)) {
                        seenChatIds.add(msgId);
                        lastActivityTime = Date.now(); // Reset timeout on new activity
                        const roleIcon = msg.role === 'user' ? '👤' : (msg.role === 'ai' ? '🧙' : '⚙️');
                        console.log(`${roleIcon} [${new Date(msg.ts).toLocaleTimeString()}] ${msg.role.toUpperCase()}:`);
                        console.log(`${msg.text}\n`);

                        // Check for completion signal in text
                        if (msg.role === 'ai' && (msg.text.includes('✅') || msg.text.includes('Complete!'))) {
                            setTimeout(() => isComplete = true, 2000);
                        }
                    }
                });
            }

            // Process Telemetry
            if (data.telemetry && Array.isArray(data.telemetry)) {
                const relevantTelemetry = data.telemetry.filter(t => t.cid === CID || t.type === 'bridge_state');
                relevantTelemetry.forEach(t => {
                    const tId = t.ts + t.type + (t.name || '');
                    if (!seenTelemetryIds.has(tId)) {
                        seenTelemetryIds.add(tId);
                        lastActivityTime = Date.now(); // Reset timeout on new activity

                        if (t.type === 'tool_call') {
                            console.log(`🛠️  [${new Date(t.ts).toLocaleTimeString()}] TOOL EXECUTION: ${t.name}`);
                            if (t.args) console.log(`   Args: ${JSON.stringify(t.args).substring(0, 100)}...`);
                            console.log(`   Status: ${t.status}\n`);
                        } else if (t.type === 'bridge_state') {
                            // State updates
                        } else {
                            console.log(`📡 [${new Date(t.ts).toLocaleTimeString()}] EVENT: ${t.type}\n`);
                        }
                    }
                });
            }

            // Check for timeout (no activity for ACTIVITY_TIMEOUT_MS)
            const timeSinceLastActivity = Date.now() - lastActivityTime;
            if (timeSinceLastActivity > ACTIVITY_TIMEOUT_MS) {
                console.log(`\n⚠️  TIMEOUT: No activity for ${Math.round(timeSinceLastActivity / 1000)}s`);
                console.log(`   Last message was likely "Evaluating next phase..." - continuation loop may have failed`);
                break;
            }

            await new Promise(r => setTimeout(r, 1000));
            pollCount++;
        }

        // 4. Get Final State & Report Impact
        console.log('📊 Fetching final graph state...');
        const finalState = await request('GET', '/api/bridge/state');
        const finalGraph = finalState.activeGraphId
            ? (Array.isArray(finalState.graphs) ? finalState.graphs.find(g => g.id === finalState.activeGraphId) : null)
            : null;

        finalCounts = {
            nodes: finalGraph ? (finalGraph.instances ? Object.keys(finalGraph.instances).length : 0) : 0,
            edges: finalGraph ? (Array.isArray(finalGraph.edgeIds) ? finalGraph.edgeIds.length : 0) : 0
        };

        // Calculate diffs
        const newNodes = [];
        if (finalGraph && finalGraph.instances) {
            const initialNodeIds = initialGraph && initialGraph.instances ? Object.keys(initialGraph.instances) : [];
            Object.entries(finalGraph.instances).forEach(([id, node]) => {
                if (!initialNodeIds.includes(id)) {
                    newNodes.push(node.name || id);
                }
            });
        }

        console.log('\n---------------------------------------------------');
        if (pollCount >= MAX_POLLS) {
            console.log('⚠️  Simulation timed out.');
        } else {
            console.log('✅ Simulation complete.');
        }

        console.log('\n📈 IMPACT REPORT:');
        console.log(`   Nodes: ${initialCounts.nodes} → ${finalCounts.nodes} (+${finalCounts.nodes - initialCounts.nodes})`);
        if (newNodes.length > 0) {
            console.log(`   ✨ New Nodes: ${newNodes.slice(0, 20).join(', ')}${newNodes.length > 20 ? `... and ${newNodes.length - 20} more` : ''}`);
        }
        console.log(`   Edges: ${initialCounts.edges} → ${finalCounts.edges} (+${finalCounts.edges - initialCounts.edges})`);
        console.log('---------------------------------------------------');

        return {
            success: isComplete,
            initial: initialCounts,
            final: finalCounts,
            newNodes
        };

    } catch (err) {
        console.error('❌ Error:', err.message);
        return { success: false, error: err.message };
    }
}

// CLI Entry point
if (process.argv[1] === new URL(import.meta.url).pathname) {
    const prompt = process.argv[2];
    const key = process.argv[3] || process.env.OPENROUTER_API_KEY;

    if (!prompt) {
        console.error('Usage: node scripts/simulate-user.js "Your prompt here" [API_KEY]');
        process.exit(1);
    }
    if (!key) {
        console.error('Error: API Key is required. Pass it as the second argument or set OPENROUTER_API_KEY env var.');
        process.exit(1);
    }

    runSimulation(prompt, key);
}
