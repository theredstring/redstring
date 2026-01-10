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
import { debugLogSync } from './src/utils/debugLogger.js';

// #region agent log
debugLogSync('agent-server.js:TOP', 'agent-server.js executing', { pid: process.pid }, 'debug-session', 'A');
// #endregion

// #region agent log
debugLogSync('agent-server.js:IMPORT_OK', 'wizard-server imported successfully', {}, 'debug-session', 'B');
// #endregion

startWizardServer()
  .then(({ port }) => {
    // #region agent log
    debugLogSync('agent-server.js:START_OK', 'Wizard started successfully', { port }, 'debug-session', 'C');
    // #endregion
    console.log(`[AgentServer] Wizard service running on port ${port}`);
  })
  .catch(e => {
    // #region agent log
    debugLogSync('agent-server.js:START_FAIL', 'Wizard failed to start', { error: e.message, stack: e.stack }, 'debug-session', 'C');
    // #endregion
    console.error('[AgentServer] Failed to start wizard service:', e);
    process.exit(1);
  });
