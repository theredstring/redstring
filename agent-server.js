// agent-server.js
// Preferred entrypoint for the Wizard agent runtime.
//
// Currently starts the legacy bridge implementation while we incrementally
// migrate logic into `src/services/agentRuntime/`.

process.env.AGENT_SERVER_MODE = 'true';

import './bridge-daemon-legacy.js';

console.log('[AgentServer] Agent server started (legacy bridge compatibility)');
