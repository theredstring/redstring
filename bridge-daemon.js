/**
 * bridge-daemon.js (compatibility shim)
 *
 * This project historically ran the agent runtime via `bridge-daemon.js`.
 * We now use `agent-server.js` which starts the clean wizard-server.
 *
 * Kept for backwards compatibility with existing scripts and docs.
 */

import './agent-server.js';
