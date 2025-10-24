// Auth adapter index: re-export existing services with stable names
// Phase 1: passthrough to avoid behavior changes

export { persistentAuth } from '../../services/persistentAuth.js';
export { oauthAutoConnect } from '../../services/oauthAutoConnect.js';

// Optionally expose typed wrappers for future phases (pure ESM)
export const getAuthStatus = () => {
  try {
    return persistentAuth.getComprehensiveAuthStatus?.() || persistentAuth.getAuthStatus();
  } catch (_) {
    return null;
  }
};



