const http = require('http');

const PROMPT = process.argv[2];
const API_KEY = process.argv[3] || process.env.OPENROUTER_API_KEY;

if (!PROMPT) {
    console.error('Usage: node scripts/simulate-user.js "Your prompt here" [API_KEY]');
    process.exit(1);
}

if (!API_KEY) {
    console.error('Error: API Key is required. Pass it as the second argument or set OPENROUTER_API_KEY env var.');
    process.exit(1);
}

const CID = `sim-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
const BRIDGE_URL = 'http://localhost:3001';

console.log(`\n🤖 Starting Wizard Simulation`);
console.log(`🆔 Conversation ID: ${CID}`);
console.log(`📝 Prompt: "${PROMPT}"`);
console.log('---------------------------------------------------\n');

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

async function main() {
    try {
        // 1. Send the user message
        console.log('📤 Sending request to Wizard...');
        await request('POST', '/api/ai/agent', {
            message: PROMPT,
            conversationHistory: [], // Start fresh
            cid: CID,
            apiConfig: {
                provider: 'openrouter',
                model: 'anthropic/claude-3.5-sonnet', // Default or make configurable
                apiKey: API_KEY
            }
        }, {
            'Authorization': `Bearer ${API_KEY}`
        });

        console.log('✅ Request sent. Listening for response...\n');

        // 2. Poll for updates
        const seenChatIds = new Set();
        const seenTelemetryIds = new Set(); // Telemetry doesn't have IDs usually, so we'll use timestamp + type
        let isComplete = false;
        let pollCount = 0;
        const MAX_POLLS = 600; // 10 minutes (1s interval)

        while (!isComplete && pollCount < MAX_POLLS) {
            const data = await request('GET', '/api/bridge/telemetry');

            // Process Chat
            if (data.chat && Array.isArray(data.chat)) {
                const relevantChat = data.chat.filter(c => c.cid === CID);
                relevantChat.forEach(msg => {
                    const msgId = msg.ts + msg.text.substring(0, 10); // Simple dedup key
                    if (!seenChatIds.has(msgId)) {
                        seenChatIds.add(msgId);
                        const roleIcon = msg.role === 'user' ? '👤' : (msg.role === 'ai' ? '🧙' : '⚙️');
                        console.log(`${roleIcon} [${new Date(msg.ts).toLocaleTimeString()}] ${msg.role.toUpperCase()}:`);
                        console.log(`${msg.text}\n`);

                        // Check for completion signal in text
                        if (msg.role === 'ai' && (msg.text.includes('✅') || msg.text.includes('Complete!'))) {
                            // We might want to wait a bit more to ensure all telemetry is captured
                            setTimeout(() => isComplete = true, 2000);
                        }
                    }
                });
            }

            // Process Telemetry (Tool Calls)
            if (data.telemetry && Array.isArray(data.telemetry)) {
                const relevantTelemetry = data.telemetry.filter(t => t.cid === CID);
                relevantTelemetry.forEach(t => {
                    const tId = t.ts + t.type + (t.name || '');
                    if (!seenTelemetryIds.has(tId)) {
                        seenTelemetryIds.add(tId);

                        if (t.type === 'tool_call') {
                            console.log(`🛠️  [${new Date(t.ts).toLocaleTimeString()}] TOOL EXECUTION: ${t.name}`);
                            if (t.args) console.log(`   Args: ${JSON.stringify(t.args).substring(0, 100)}...`);
                            console.log(`   Status: ${t.status}\n`);
                        } else if (t.type === 'bridge_state') {
                            // Ignore state updates to reduce noise, or log sparingly
                        } else {
                            console.log(`📡 [${new Date(t.ts).toLocaleTimeString()}] EVENT: ${t.type}\n`);
                        }
                    }
                });
            }

            await new Promise(r => setTimeout(r, 1000));
            pollCount++;
        }

        if (pollCount >= MAX_POLLS) {
            console.log('⚠️  Simulation timed out.');
        } else {
            console.log('✅ Simulation complete.');
        }

    } catch (err) {
        console.error('❌ Error:', err.message);
    }
}

main();
