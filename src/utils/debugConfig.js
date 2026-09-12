/**
 * Debug Configuration for Redstring
 * Provides debugging options to disable features for testing purposes
 */

// Debug configuration keys
const DEBUG_STORAGE_KEYS = {
  DISABLE_LOCAL_STORAGE: 'redstring_debug_disable_local_storage',
  DEBUG_MODE: 'redstring_debug_mode',
  FORCE_GIT_ONLY: 'redstring_debug_force_git_only',
  LOG_LEVEL: 'redstring_debug_log_level',
  ENABLE_WIZARD: 'redstring_debug_enable_wizard',
  SHOW_NODE_HITBOXES: 'redstring_debug_show_node_hitboxes',
  // Was NodeCanvas-local `useState` while the only way to toggle it was the
  // Debug menu rendered beside it. The Settings page is nowhere near NodeCanvas,
  // so it lives here with the other debug flags and NodeCanvas subscribes.
  SHOW_DEBUG_OVERLAY: 'redstring_debug_show_overlay',
  WIZARD_DESTINATION: 'redstring_wizard_destination'
};

// Retired in favour of WIZARD_DESTINATION. Still named here so initialize() can
// migrate a stored value once and then delete the key — leaving it behind would
// let a stale 'ask' be inherited by anything that reuses the name later.
const LEGACY_WIZARD_PREF_KEYS = [
  'redstring_wizard_connection_pref',
  'redstring_wizard_node_pref'
];

// Where an Ask The Wizard prompt goes. This used to be a tri-state per element
// kind ('ask' | 'new' | 'current', separately for Connections and Things), where
// 'ask' meant "show the confirm dialog". The dialog now always opens — it is how
// you choose WHAT to ask — so 'ask' has nothing left to mean, and there was never
// a reason for Connections and Things to remember different destinations.
const WIZARD_DESTINATIONS = ['new', 'current'];

const hasBrowserWindow = typeof window !== 'undefined';
const hasLocalStorage = hasBrowserWindow && typeof window.localStorage !== 'undefined';
const browserLocationSearch =
  hasBrowserWindow && typeof window.location !== 'undefined'
    ? window.location.search
    : '';

class DebugConfig {
  constructor() {
    this.listeners = new Set();
    this.isInitialized = false;
    this.config = {};
    this.storage = hasLocalStorage ? window.localStorage : null;
    this.initialize();
  }

  initialize() {
    if (this.isInitialized) return;

    if (!this.storage) {
      // Default configuration for non-browser environments
      this.config = {
        disableLocalStorage: false,
        debugMode: false,
        forceGitOnly: false,
        logLevel: 'info',
        enableWizard: true,
        showNodeHitboxes: false,
        showDebugOverlay: false,
        wizardDestination: 'new'
      };
      this.isInitialized = true;
      return;
    }

    try {
      // Load existing debug settings from localStorage
      const storedDestination = this.migrateWizardDestination();
      this.config = {
        disableLocalStorage: this.getBooleanSetting(DEBUG_STORAGE_KEYS.DISABLE_LOCAL_STORAGE, false),
        debugMode: this.getBooleanSetting(DEBUG_STORAGE_KEYS.DEBUG_MODE, false),
        forceGitOnly: this.getBooleanSetting(DEBUG_STORAGE_KEYS.FORCE_GIT_ONLY, false),
        logLevel: this.getStringSetting(DEBUG_STORAGE_KEYS.LOG_LEVEL, 'info'),
        enableWizard: this.getBooleanSetting(DEBUG_STORAGE_KEYS.ENABLE_WIZARD, true),
        showNodeHitboxes: this.getBooleanSetting(DEBUG_STORAGE_KEYS.SHOW_NODE_HITBOXES, false),
        showDebugOverlay: this.getBooleanSetting(DEBUG_STORAGE_KEYS.SHOW_DEBUG_OVERLAY, false),
        wizardDestination: storedDestination
      };

      // Check URL parameters for debug overrides
      const urlParams = new URLSearchParams(browserLocationSearch);

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

      if (urlParams.has('enable-wizard') || urlParams.get('debug') === 'wizard') {
        this.config.enableWizard = true;
        console.log('[DebugConfig] Wizard enabled via URL parameter');
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
        logLevel: 'info',
        enableWizard: false,
        showNodeHitboxes: false,
        showDebugOverlay: false,
        wizardDestination: 'new'
      };
      this.isInitialized = true;
    }
  }

  getBooleanSetting(key, defaultValue) {
    if (!this.storage) return defaultValue;

    try {
      const value = this.storage.getItem(key);
      if (value === null) return defaultValue;
      return value === 'true';
    } catch (error) {
      console.warn(`[DebugConfig] Failed to read ${key}:`, error);
      return defaultValue;
    }
  }

  getStringSetting(key, defaultValue) {
    if (!this.storage) return defaultValue;

    try {
      const value = this.storage.getItem(key);
      return value !== null ? value : defaultValue;
    } catch (error) {
      console.warn(`[DebugConfig] Failed to read ${key}:`, error);
      return defaultValue;
    }
  }

  setSetting(key, value) {
    if (!this.storage) return;

    try {
      if (typeof value === 'boolean') {
        this.storage.setItem(key, value.toString());
      } else {
        this.storage.setItem(key, value);
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

  // Check if Wizard is enabled
  isWizardEnabled() {
    return this.config.enableWizard;
  }

  // Check if node hitboxes should be shown
  isNodeHitboxesEnabled() {
    return this.config.showNodeHitboxes || false;
  }

  // Check if the on-canvas debug overlay should be shown
  isDebugOverlayEnabled() {
    return this.config.showDebugOverlay || false;
  }

  // Where the next Ask The Wizard prompt goes: 'new' conversation or add to 'current'.
  getWizardDestination() {
    const v = this.config.wizardDestination;
    return WIZARD_DESTINATIONS.includes(v) ? v : 'new';
  }

  // One-time move off the retired per-element tri-state prefs. A stored 'current'
  // is a real choice and carries over; 'ask' (the old default, meaning "show the
  // dialog") no longer names anything, so it lands on 'new'. The Connection pref
  // wins where the two disagreed, being the one people actually set.
  migrateWizardDestination() {
    const stored = this.getStringSetting(DEBUG_STORAGE_KEYS.WIZARD_DESTINATION, null);
    if (WIZARD_DESTINATIONS.includes(stored)) return stored;

    let migrated = 'new';
    for (const key of LEGACY_WIZARD_PREF_KEYS) {
      const legacy = this.getStringSetting(key, null);
      if (legacy === 'current' || legacy === 'new') { migrated = legacy; break; }
    }
    try {
      this.setSetting(DEBUG_STORAGE_KEYS.WIZARD_DESTINATION, migrated);
      LEGACY_WIZARD_PREF_KEYS.forEach((key) => this.storage?.removeItem?.(key));
    } catch { /* a storage that won't take the write just re-migrates next launch */ }
    return migrated;
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

  // Enable/disable Wizard
  setWizardEnabled(enabled) {
    this.config.enableWizard = enabled;
    this.setSetting(DEBUG_STORAGE_KEYS.ENABLE_WIZARD, enabled);
    this.notifyListeners();
    console.log(`[DebugConfig] Wizard ${enabled ? 'ENABLED' : 'DISABLED'}`);
  }

  // Enable/disable node hitbox visualization
  setNodeHitboxesEnabled(enabled) {
    this.config.showNodeHitboxes = enabled;
    this.setSetting(DEBUG_STORAGE_KEYS.SHOW_NODE_HITBOXES, enabled);
    this.notifyListeners();
    console.log(`[DebugConfig] Node hitboxes ${enabled ? 'ENABLED' : 'DISABLED'}`);
  }

  // Show/hide the on-canvas debug overlay
  setDebugOverlayEnabled(enabled) {
    this.config.showDebugOverlay = enabled;
    this.setSetting(DEBUG_STORAGE_KEYS.SHOW_DEBUG_OVERLAY, enabled);
    this.notifyListeners();
    console.log(`[DebugConfig] Debug overlay ${enabled ? 'ENABLED' : 'DISABLED'}`);
  }

  // Set where the next Ask The Wizard prompt goes: 'new' | 'current'
  setWizardDestination(value) {
    const next = WIZARD_DESTINATIONS.includes(value) ? value : 'new';
    this.config.wizardDestination = next;
    this.setSetting(DEBUG_STORAGE_KEYS.WIZARD_DESTINATION, next);
    this.notifyListeners();
    console.log(`[DebugConfig] Wizard destination set to: ${next}`);
  }

  // Clear all debug settings
  reset() {
    if (!this.storage) {
      this.config = {
        disableLocalStorage: false,
        debugMode: false,
        forceGitOnly: false,
        logLevel: 'info',
        enableWizard: false,
        showNodeHitboxes: false,
        showDebugOverlay: false,
        wizardDestination: 'new'
      };
      this.notifyListeners();
      return;
    }

    try {
      Object.values(DEBUG_STORAGE_KEYS).forEach(key => {
        this.storage.removeItem(key);
      });

      this.config = {
        disableLocalStorage: false,
        debugMode: false,
        forceGitOnly: false,
        logLevel: 'info',
        enableWizard: false,
        showNodeHitboxes: false,
        showDebugOverlay: false,
        wizardDestination: 'new'
      };

      this.notifyListeners();
      console.log('[DebugConfig] All debug settings cleared, wizard connection preference reset');
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
    const urlParams = new URLSearchParams(browserLocationSearch);
    return {
      debug: urlParams.has('debug'),
      disableLocalStorage: urlParams.has('disable-local-storage'),
      forceGitOnly: urlParams.has('force-git-only'),
      logLevel: urlParams.get('log-level'),
      enableWizard: urlParams.has('enable-wizard')
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
    console.log('  ?enable-wizard - Enable Wizard');
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
        enableWizard: (enabled = true) => this.setWizardEnabled(enabled),
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
export const isWizardEnabled = () => debugConfig.isWizardEnabled();
export const getWizardDestination = () => debugConfig.getWizardDestination();
export const setWizardDestination = (value) => debugConfig.setWizardDestination(value);
export const getDebugConfig = () => debugConfig.getConfig();

export default debugConfig;
