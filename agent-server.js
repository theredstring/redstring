/**
 * agent-server.js - The Wizard backend service
 * 
 * This is the main entry point for the AI wizard runtime.
 * It runs as a child process of Electron or standalone.
 * 
 * Replaces the old 5000+ line bridge-daemon-legacy.js with a clean implementation.
 */

process.env.AGENT_SERVER_MODE = 'true';

// #region agent log
fetch('http://127.0.0.1:7242/ingest/52d0fe28-158e-49a4-b331-f013fcb14181',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'agent-server.js:TOP',message:'agent-server.js executing',data:{pid:process.pid},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'A'})}).catch(()=>{});
// #endregion

// Import and start the clean wizard server
import { startWizardServer } from './wizard-server.js';

// #region agent log
fetch('http://127.0.0.1:7242/ingest/52d0fe28-158e-49a4-b331-f013fcb14181',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'agent-server.js:IMPORT_OK',message:'wizard-server imported successfully',data:{},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'B'})}).catch(()=>{});
// #endregion

startWizardServer()
  .then(({ port }) => {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/52d0fe28-158e-49a4-b331-f013fcb14181',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'agent-server.js:START_OK',message:'Wizard started successfully',data:{port},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'C'})}).catch(()=>{});
    // #endregion
    console.log(`[AgentServer] Wizard service running on port ${port}`);
  })
  .catch(e => {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/52d0fe28-158e-49a4-b331-f013fcb14181',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'agent-server.js:START_FAIL',message:'Wizard failed to start',data:{error:e.message,stack:e.stack},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'C'})}).catch(()=>{});
    // #endregion
    console.error('[AgentServer] Failed to start wizard service:', e);
    process.exit(1);
  });
