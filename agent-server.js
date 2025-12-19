// agent-server.js
// Preferred entrypoint for the Wizard agent runtime.
//
// Currently starts the legacy bridge implementation while we incrementally
// migrate logic into `src/services/agentRuntime/`.

process.env.AGENT_SERVER_MODE = 'true';

import './bridge-daemon-legacy.js';
import { runAgent } from './src/wizard/AgentLoop.js';

// Get Express app from bridge-daemon-legacy (it exports it)
// For now, we'll add the endpoint directly to bridge-daemon-legacy
// This will be cleaned up when legacy is removed

// Ensure scheduler is started (reuse from bridge-daemon-legacy)
let scheduler = null;
async function ensureSchedulerStarted() {
  if (!scheduler) {
    try {
      const mod = await import('./src/services/orchestrator/Scheduler.js');
      scheduler = mod.default;
    } catch (e) {
      console.warn('[AgentServer] Failed to load scheduler:', e.message);
    }
  }
  if (scheduler && typeof scheduler.start === 'function') {
    scheduler.start();
  }
}

console.log('[AgentServer] Agent server started (legacy bridge compatibility + new Wizard endpoint)');
