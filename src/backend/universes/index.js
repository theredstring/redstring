// Universes adapter index: re-export universeBackend as the single source of truth

import universeBackend from '../../services/universeBackend.js';

// Export universeBackend as default
export default universeBackend;

// Export SOURCE_OF_TRUTH constant
export const SOURCE_OF_TRUTH = {
  LOCAL: 'local',    // Local .redstring file is authoritative
  GIT: 'git',        // Git repository is authoritative (default)
  BROWSER: 'browser' // Browser storage fallback for mobile
};


