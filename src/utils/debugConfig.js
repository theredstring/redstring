/**
 * Debug Configuration for Redstring
 * Provides debugging options to disable features for testing purposes
 */

// Debug configuration keys
const DEBUG_STORAGE_KEYS = {
  DISABLE_LOCAL_STORAGE: 'redstring_debug_disable_local_storage',
  DEBUG_MODE: 'redstring_debug_mode',
  FORCE_GIT_ONLY: 'redstring_debug_force_git_only',
  LOG_LEVEL: 'redstring_debug_log_level'
};

class DebugConfig {
  constructor() {
    this.listeners = new Set();
    this.isInitialized = false;
    this.config = {};
    this.initialize();
  }

  initialize() {
    if (this.isInitialized) return;
    
    try {
      // Load existing debug settings from localStorage
      this.config = {
        disableLocalStorage: this.getBooleanSetting(DEBUG_STORAGE_KEYS.DISABLE_LOCAL_STORAGE, false),
        debugMode: this.getBooleanSetting(DEBUG_STORAGE_KEYS.DEBUG_MODE, false),
        forceGitOnly: this.getBooleanSetting(DEBUG_STORAGE_KEYS.FORCE_GIT_ONLY, false),
        logLevel: this.getStringSetting(DEBUG_STORAGE_KEYS.LOG_LEVEL, 'info')
      };

      // Check URL parameters for debug overrides
      const urlParams = new URLSearchParams(window.location.search);
      
      if (urlParams.has('debug')) {
        this.config.debugMode = true;
      }
      
      if (urlParams.has('disable-local-storage') || urlParams.get('debug') === 'no-local') {
        this.config.disableLocalStorage = true;
        console.warn('[DebugConfig] Local storage disabled via URL parameter');
      }
      
      if (urlParams.has('force-git-only') || urlParams.get('debug') === 'git-only') {
        this.config.forceGitOnly = true;
        console.warn('[DebugConfig] Forced Git-Only mode via URL parameter');
      }

      if (urlParams.has('log-level')) {
        this.config.logLevel = urlParams.get('log-level');
      }

      this.isInitialized = true;
      this.notifyListeners();

      console.log('[DebugConfig] Initialized:', this.config);
    } catch (error) {
      console.error('[DebugConfig] Failed to initialize:', error);
      // Use safe defaults
      this.config = {
        disableLocalStorage: false,
        debugMode: false,
        forceGitOnly: false,
        logLevel: 'info'
      };
      this.isInitialized = true;
    }
  }

  getBooleanSetting(key, defaultValue) {
    try {
      const value = localStorage.getItem(key);
      if (value === null) return defaultValue;
      return value === 'true';
    } catch (error) {
      console.warn(`[DebugConfig] Failed to read ${key}:`, error);
      return defaultValue;
    }
  }

  getStringSetting(key, defaultValue) {
    try {
      const value = localStorage.getItem(key);
      return value !== null ? value : defaultValue;
    } catch (error) {
      console.warn(`[DebugConfig] Failed to read ${key}:`, error);
      return defaultValue;
    }
  }

  setSetting(key, value) {
    try {
      if (typeof value === 'boolean') {
        localStorage.setItem(key, value.toString());
      } else {
        localStorage.setItem(key, value);
      }
    } catch (error) {
      console.error(`[DebugConfig] Failed to save ${key}:`, error);
    }
  }

  // Get current debug configuration
  getConfig() {
    return { ...this.config };
  }

  // Check if local storage should be disabled
  isLocalStorageDisabled() {
    return this.config.disableLocalStorage;
  }

  // Check if debug mode is enabled
  isDebugMode() {
    return this.config.debugMode;
  }

  // Check if Git-Only mode is forced
  isGitOnlyForced() {
    return this.config.forceGitOnly;
  }

  // Get log level
  getLogLevel() {
    return this.config.logLevel;
  }

  // Enable/disable local storage (for debugging)
  setLocalStorageDisabled(disabled) {
    this.config.disableLocalStorage = disabled;
    this.setSetting(DEBUG_STORAGE_KEYS.DISABLE_LOCAL_STORAGE, disabled);
    this.notifyListeners();
    
    console.warn(`[DebugConfig] Local storage ${disabled ? 'DISABLED' : 'ENABLED'} for debugging`);
    
    if (disabled) {
      console.warn('[DebugConfig] ⚠️  All data will be lost on browser reload when local storage is disabled');
    }
  }

  // Enable/disable debug mode
  setDebugMode(enabled) {
    this.config.debugMode = enabled;
    this.setSetting(DEBUG_STORAGE_KEYS.DEBUG_MODE, enabled);
    this.notifyListeners();
    console.log(`[DebugConfig] Debug mode ${enabled ? 'ENABLED' : 'DISABLED'}`);
  }

  // Force Git-Only mode (overrides device detection)
  setForceGitOnly(forced) {
    this.config.forceGitOnly = forced;
    this.setSetting(DEBUG_STORAGE_KEYS.FORCE_GIT_ONLY, forced);
    this.notifyListeners();
    console.warn(`[DebugConfig] Git-Only mode ${forced ? 'FORCED' : 'AUTO-DETECT'}`);
  }

  // Set log level
  setLogLevel(level) {
    this.config.logLevel = level;
    this.setSetting(DEBUG_STORAGE_KEYS.LOG_LEVEL, level);
    this.notifyListeners();
    console.log(`[DebugConfig] Log level set to: ${level}`);
  }

  // Clear all debug settings
  reset() {
    try {
      Object.values(DEBUG_STORAGE_KEYS).forEach(key => {
        localStorage.removeItem(key);
      });
      
      this.config = {
        disableLocalStorage: false,
        debugMode: false,
        forceGitOnly: false,
        logLevel: 'info'
      };
      
      this.notifyListeners();
      console.log('[DebugConfig] All debug settings cleared');
    } catch (error) {
      console.error('[DebugConfig] Failed to reset:', error);
    }
  }

  // Add listener for configuration changes
  addListener(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  // Notify all listeners of configuration changes
  notifyListeners() {
    this.listeners.forEach(callback => {
      try {
        callback(this.getConfig());
      } catch (error) {
        console.error('[DebugConfig] Listener error:', error);
      }
    });
  }

  // Get debug status summary
  getDebugStatus() {
    return {
      active: this.config.debugMode || 
              this.config.disableLocalStorage || 
              this.config.forceGitOnly ||
              this.config.logLevel !== 'info',
      settings: this.getConfig(),
      urlOverrides: this.getURLOverrides()
    };
  }

  // Get URL parameter overrides
  getURLOverrides() {
    const urlParams = new URLSearchParams(window.location.search);
    return {
      debug: urlParams.has('debug'),
      disableLocalStorage: urlParams.has('disable-local-storage'),
      forceGitOnly: urlParams.has('force-git-only'),
      logLevel: urlParams.get('log-level')
    };
  }

  // Console methods for easy debugging
  logToConsole() {
    console.group('🐛 Redstring Debug Configuration');
    console.log('Status:', this.getDebugStatus());
    console.log('Available URL parameters:');
    console.log('  ?debug - Enable debug mode');
    console.log('  ?debug=no-local - Disable local storage');
    console.log('  ?debug=git-only - Force Git-Only mode');
    console.log('  ?disable-local-storage - Disable local storage');
    console.log('  ?force-git-only - Force Git-Only mode');
    console.log('  ?log-level=debug - Set log level');
    console.groupEnd();
  }

  // Expose debugging methods globally for console access
  exposeGlobalDebug() {
    if (typeof window !== 'undefined') {
      window.RedstringDebug = {
        config: () => this.getConfig(),
        status: () => this.getDebugStatus(),
        disableLocalStorage: (disabled = true) => this.setLocalStorageDisabled(disabled),
        enableDebug: (enabled = true) => this.setDebugMode(enabled),
        forceGitOnly: (forced = true) => this.setForceGitOnly(forced),
        setLogLevel: (level) => this.setLogLevel(level),
        reset: () => this.reset(),
        help: () => this.logToConsole()
      };

      console.log('🐛 Redstring debugging available at window.RedstringDebug');
      console.log('Type RedstringDebug.help() for available commands');
    }
  }
}

// Export singleton instance
export const debugConfig = new DebugConfig();

// Always expose debugging interface globally
if (typeof window !== 'undefined') {
  debugConfig.exposeGlobalDebug();
}

// Export utility functions
export const isLocalStorageDisabled = () => debugConfig.isLocalStorageDisabled();
export const isDebugMode = () => debugConfig.isDebugMode();
export const isGitOnlyForced = () => debugConfig.isGitOnlyForced();
export const getDebugConfig = () => debugConfig.getConfig();

export default debugConfig;