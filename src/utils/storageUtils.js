/**
 * Utility functions for storage management
 */

/**
 * Generates a storage key that respects the current session or test mode.
 * 
 * Priority:
 * 1. 'session' query param -> `session_{id}_{key}`
 * 2. 'test' query param -> `test_{key}`
 * 3. Default -> `{key}`
 * 
 * @param {string} key - The base storage key
 * @returns {string} The scoped storage key
 */
export const getStorageKey = (key) => {
    if (typeof window === 'undefined') return key;

    const params = new URLSearchParams(window.location.search);

    // Custom session ID for arbitrary fresh instances
    // Usage: ?session=fresh1
    const session = params.get('session');
    if (session) {
        return `session_${session}_${key}`;
    }

    // Legacy test mode support
    // Usage: ?test=true
    const isTestMode = params.get('test') === 'true';
    return isTestMode ? `test_${key}` : key;
};
