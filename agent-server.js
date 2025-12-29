/**
 * agent-server.js - The Wizard backend service
 * 
 * This is the main entry point for the AI wizard runtime.
 * It runs as a child process of Electron or standalone.
 * 
 * Replaces the old 5000+ line bridge-daemon-legacy.js with a clean implementation.
 */

process.env.AGENT_SERVER_MODE = 'true';

// Import and start the clean wizard server
import { startWizardServer } from './wizard-server.js';

startWizardServer()
  .then(({ port }) => {
    console.log(`[AgentServer] Wizard service running on port ${port}`);
  })
  .catch(e => {
    console.error('[AgentServer] Failed to start wizard service:', e);
    process.exit(1);
  });
