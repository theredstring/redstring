/**
 * API Key Manager for Redstring AI Chat
 * 
 * Securely stores and manages API keys in browser localStorage
 * Keys are stored locally on the user's machine only
 */

class APIKeyManager {
  constructor() {
    this.STORAGE_KEY = 'redstring_ai_api_key';
    this.ENCRYPTION_KEY = 'redstring_ai_encryption_key';
    this.STORAGE_PROFILES = 'redstring_ai_api_profiles';
    this.ACTIVE_PROFILE = 'redstring_ai_active_profile';
  }

  /**
   * Store API key and configuration securely in localStorage
   * @param {string} apiKey - The API key to store
   * @param {string} provider - The provider (e.g., 'anthropic', 'openai', 'openrouter')
   * @param {Object} config - Additional configuration
   * @param {string} config.endpoint - Custom API endpoint URL
   * @param {string} config.model - Preferred model name
   * @param {Object} config.settings - Additional model settings (temperature, max_tokens, etc.)
   */
  async storeAPIKey(apiKey, provider = 'anthropic', config = {}) {
    try {
      // Simple obfuscation (in production, you might want stronger encryption)
      const obfuscatedKey = this.obfuscate(apiKey);
      
      const keyData = {
        key: obfuscatedKey,
        provider,
        endpoint: config.endpoint || this.getDefaultEndpoint(provider),
        model: config.model || this.getDefaultModel(provider),
        settings: {
          temperature: 0.7,
          max_tokens: 1000,
          ...config.settings
        },
        timestamp: Date.now(),
        version: '2.0',
        name: (config.profileName || provider)
      };

      // Save into profiles list
      const profiles = await this._getProfilesInternal();
      const id = (config.profileId) || `prof_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
      profiles[id] = keyData;
      localStorage.setItem(this.STORAGE_PROFILES, JSON.stringify(profiles));
      localStorage.setItem(this.ACTIVE_PROFILE, id);

      console.log('[API Key Manager] API profile stored successfully');
      // Maintain legacy single-key for backward compat
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(keyData));
      
      return { success: true, id, name: keyData.name, provider, endpoint: keyData.endpoint, model: keyData.model };
    } catch (error) {
      console.error('[API Key Manager] Failed to store API configuration:', error);
      throw new Error('Failed to store API configuration');
    }
  }

  /**
   * Retrieve API key from localStorage
   * @returns {string|null} The API key or null if not found
   */
  async getAPIKey() {
    try {
      const keyData = await this._getActiveProfileData();
      if (!keyData) return null;
      const deobfuscatedKey = this.deobfuscate(keyData.key);
      
      console.log('[API Key Manager] API key retrieved successfully');
      return deobfuscatedKey;
    } catch (error) {
      console.error('[API Key Manager] Failed to retrieve API key:', error);
      return null;
    }
  }

  /**
   * Get API key info (provider, endpoint, model, timestamp, etc.)
   * @returns {object|null} Key information or null if not found
   */
  async getAPIKeyInfo() {
    try {
      const keyData = await this._getActiveProfileData();
      if (!keyData) return null;
      
      // Handle legacy format (version 1.0)
      if (keyData.version === '1.0') {
        return {
          provider: keyData.provider,
          endpoint: this.getDefaultEndpoint(keyData.provider),
          model: this.getDefaultModel(keyData.provider),
          settings: { temperature: 0.7, max_tokens: 1000 },
          timestamp: keyData.timestamp,
          version: keyData.version,
          hasKey: true,
          isLegacy: true
        };
      }
      
      // Current format (version 2.0+)
      return {
        name: keyData.name,
        provider: keyData.provider,
        endpoint: keyData.endpoint,
        model: keyData.model,
        settings: keyData.settings,
        timestamp: keyData.timestamp,
        version: keyData.version,
        hasKey: true,
        activeProfileId: localStorage.getItem(this.ACTIVE_PROFILE) || null
      };
    } catch (error) {
      console.error('[API Key Manager] Failed to get API key info:', error);
      return null;
    }
  }

  /**
   * Check if API key exists
   * @returns {boolean} True if key exists
   */
  async hasAPIKey() {
    const key = await this.getAPIKey();
    return key !== null;
  }

  /**
   * Remove API key from localStorage
   */
  async removeAPIKey() {
    try {
      // Remove active profile only
      const activeId = localStorage.getItem(this.ACTIVE_PROFILE);
      const profiles = await this._getProfilesInternal();
      if (activeId && profiles[activeId]) {
        delete profiles[activeId];
        localStorage.setItem(this.STORAGE_PROFILES, JSON.stringify(profiles));
      }
      localStorage.removeItem(this.ACTIVE_PROFILE);
      // Keep legacy key for safety
      console.log('[API Key Manager] API key removed successfully');
      return { success: true };
    } catch (error) {
      console.error('[API Key Manager] Failed to remove API key:', error);
      throw new Error('Failed to remove API key');
    }
  }

  // Multiple profiles API
  async listProfiles() {
    const profiles = await this._getProfilesInternal();
    return Object.entries(profiles).map(([id, data]) => ({ id, name: data.name, provider: data.provider, model: data.model, endpoint: data.endpoint, timestamp: data.timestamp }));
  }

  async setActiveProfile(profileId) {
    const profiles = await this._getProfilesInternal();
    if (!profiles[profileId]) throw new Error('Profile not found');
    localStorage.setItem(this.ACTIVE_PROFILE, profileId);
    // Update legacy key mirror
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(profiles[profileId]));
    return { success: true };
  }

  async deleteProfile(profileId) {
    const profiles = await this._getProfilesInternal();
    if (profiles[profileId]) {
      delete profiles[profileId];
      localStorage.setItem(this.STORAGE_PROFILES, JSON.stringify(profiles));
      if (localStorage.getItem(this.ACTIVE_PROFILE) === profileId) {
        localStorage.removeItem(this.ACTIVE_PROFILE);
      }
      return { success: true };
    }
    throw new Error('Profile not found');
  }

  // Internal helpers
  async _getActiveProfileData() {
    const profiles = await this._getProfilesInternal();
    const activeId = localStorage.getItem(this.ACTIVE_PROFILE);
    if (activeId && profiles[activeId]) return profiles[activeId];
    // Migrate legacy single key if present
    const legacy = localStorage.getItem(this.STORAGE_KEY);
    if (legacy) {
      const data = JSON.parse(legacy);
      const id = `prof_legacy`;
      profiles[id] = data;
      localStorage.setItem(this.STORAGE_PROFILES, JSON.stringify(profiles));
      localStorage.setItem(this.ACTIVE_PROFILE, id);
      return data;
    }
    return null;
  }

  async _getProfilesInternal() {
    const raw = localStorage.getItem(this.STORAGE_PROFILES);
    if (!raw) return {};
    try { return JSON.parse(raw) || {}; } catch { return {}; }
  }

  /**
   * Validate API key format
   * @param {string} apiKey - The API key to validate
   * @returns {boolean} True if valid
   */
  validateAPIKey(apiKey) {
    if (!apiKey || typeof apiKey !== 'string') {
      return false;
    }

    // Remove whitespace
    const cleanKey = apiKey.trim();
    
    // Just check it's not empty and has reasonable length
    return cleanKey.length >= 5;
  }

  /**
   * Simple obfuscation (not encryption, just makes it not plain text)
   * @param {string} text - Text to obfuscate
   * @returns {string} Obfuscated text
   */
  obfuscate(text) {
    if (!text || typeof text !== 'string') {
      return '';
    }
    return btoa(text.split('').reverse().join(''));
  }

  /**
   * Deobfuscate text
   * @param {string} obfuscated - Obfuscated text
   * @returns {string} Original text
   */
  deobfuscate(obfuscated) {
    if (!obfuscated || typeof obfuscated !== 'string') {
      return '';
    }
    try {
      return atob(obfuscated).split('').reverse().join('');
    } catch (error) {
      console.error('Failed to deobfuscate:', error);
      return '';
    }
  }

  /**
   * Get default API endpoint for a provider
   * @param {string} provider - The provider name
   * @returns {string} Default endpoint URL
   */
  getDefaultEndpoint(provider) {
    const endpoints = {
      'anthropic': 'https://api.anthropic.com/v1/messages',
      'openai': 'https://api.openai.com/v1/chat/completions',
      'openrouter': 'https://openrouter.ai/api/v1/chat/completions',
      'google': 'https://generativelanguage.googleapis.com/v1beta/models',
      'cohere': 'https://api.cohere.ai/v1/chat',
      'custom': ''
    };
    return endpoints[provider] || 'https://openrouter.ai/api/v1/chat/completions';
  }

  /**
   * Get default model for a provider
   * @param {string} provider - The provider name
   * @returns {string} Default model name
   */
  getDefaultModel(provider) {
    const models = {
      'anthropic': 'claude-3-sonnet-20240229',
      'openai': 'gpt-4o',
      'openrouter': 'anthropic/claude-3-sonnet', // Fixed: Use the correct model name
      'google': 'gemini-pro',
      'cohere': 'command-r',
      'custom': ''
    };
    return models[provider] || 'anthropic/claude-3-sonnet'; // Fixed: Use the correct model name
  }

  /**
   * Get popular models for OpenRouter
   * @returns {Array} List of popular OpenRouter models
   */
  getOpenRouterModels() {
    return [
      { id: 'anthropic/claude-3-sonnet', name: 'Claude 3 Sonnet', provider: 'Anthropic' },
      { id: 'anthropic/claude-3-haiku', name: 'Claude 3 Haiku', provider: 'Anthropic' },
      { id: 'anthropic/claude-3-opus', name: 'Claude 3 Opus', provider: 'Anthropic' },
      { id: 'openai/gpt-4o', name: 'GPT-4o', provider: 'OpenAI' },
      { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini', provider: 'OpenAI' },
      { id: 'openai/gpt-4-turbo', name: 'GPT-4 Turbo', provider: 'OpenAI' },
      { id: 'openai/gpt-3.5-turbo', name: 'GPT-3.5 Turbo', provider: 'OpenAI' },
      { id: 'meta-llama/llama-3.1-405b-instruct', name: 'Llama 3.1 405B', provider: 'Meta' },
      { id: 'google/gemini-pro-1.5', name: 'Gemini Pro 1.5', provider: 'Google' },
      { id: 'perplexity/llama-3.1-sonar-large-128k-online', name: 'Perplexity Sonar Large (Online)', provider: 'Perplexity' },
      { id: 'mistralai/mixtral-8x7b-instruct', name: 'Mixtral 8x7B', provider: 'Mistral AI' }
    ];
  }

  /**
   * Get common provider presets (updated with OpenRouter)
   * @returns {Array} List of common providers for quick selection
   */
  getCommonProviders() {
    return [
      { id: 'openrouter', name: 'OpenRouter (200+ Models)' },
      { id: 'anthropic', name: 'Anthropic Claude' },
      { id: 'openai', name: 'OpenAI GPT' },
      { id: 'google', name: 'Google Gemini' },
      { id: 'cohere', name: 'Cohere' },
      { id: 'custom', name: 'Custom Provider' }
    ];
  }
}

// Create and export a singleton instance
const apiKeyManager = new APIKeyManager();
export default apiKeyManager; 