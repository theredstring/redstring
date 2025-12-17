// bridge-daemon.js (compatibility shim)
//
// This project historically ran the agent runtime via `bridge-daemon.js`.
// We now prefer `agent-server.js` as the entrypoint.
//
// Kept for backwards compatibility with existing scripts and docs.

import './agent-server.js';
