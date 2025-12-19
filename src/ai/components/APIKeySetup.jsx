import React, { useState, useEffect } from 'react';
import { Key, Eye, EyeOff, CheckCircle, AlertCircle, ExternalLink, Settings, Trash2 } from 'lucide-react';
import apiKeyManager from '../../services/apiKeyManager.js';
import './APIKeySetup.css';

const APIKeySetup = ({ onKeySet, onClose, inline = false }) => {
  const [apiKey, setApiKey] = useState('');
  const [provider, setProvider] = useState('openrouter');
  const [customProviderName, setCustomProviderName] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [model, setModel] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [existingKeyInfo, setExistingKeyInfo] = useState(null);
  const [isValidating, setIsValidating] = useState(false);
  const [recentModels, setRecentModels] = useState([]);
  const [isEditingExisting, setIsEditingExisting] = useState(false);
  const [allowKeyEdit, setAllowKeyEdit] = useState(true);
  const [localPresets] = useState(() => apiKeyManager.getLocalProviderPresets());
  const [selectedPreset, setSelectedPreset] = useState(null);
  const [connectionTestResult, setConnectionTestResult] = useState(null);
  const [isTestingConnection, setIsTestingConnection] = useState(false);

  const providers = apiKeyManager.getCommonProviders();

  useEffect(() => {
    loadExistingKey();
    loadRecentModels();
  }, []);

  // Initialize defaults when component loads
  useEffect(() => {
    if (!existingKeyInfo) {
      setEndpoint(apiKeyManager.getDefaultEndpoint(provider));
      setModel(apiKeyManager.getDefaultModel(provider));
    }
  }, [provider, existingKeyInfo]);

  const loadExistingKey = async () => {
    try {
      const keyInfo = await apiKeyManager.getAPIKeyInfo();
      if (keyInfo) {
        setExistingKeyInfo(keyInfo);
        setProvider(keyInfo.provider);
        setEndpoint(keyInfo.endpoint || '');
        setModel(keyInfo.model || '');
        setIsEditingExisting(false);
        setAllowKeyEdit(false);
      } else {
        setAllowKeyEdit(true);
      }
    } catch (error) {
      console.error('Failed to load existing key info:', error);
    }
  };

  const loadRecentModels = async () => {
    try {
      if (typeof apiKeyManager.getRecentOpenRouterModels === 'function') {
        const models = await apiKeyManager.getRecentOpenRouterModels();
        setRecentModels(models);
      }
    } catch (err) {
      console.warn('Failed to load recent OpenRouter models:', err);
    }
  };

  const handleProviderChange = (newProvider) => {
    setProvider(newProvider);
    setSelectedPreset(null);
    setConnectionTestResult(null);
    // Auto-set defaults for known providers
    if (newProvider !== 'custom') {
      setEndpoint(apiKeyManager.getDefaultEndpoint(newProvider));
      setModel(apiKeyManager.getDefaultModel(newProvider));
    } else {
      setEndpoint('');
      setModel('');
    }
  };

  const handlePresetSelect = (preset) => {
    setSelectedPreset(preset);
    setProvider('local');
    setEndpoint(preset.endpoint);
    setModel(preset.commonModels[0] || '');
    if (!preset.requiresApiKey) {
      setApiKey('local'); // Placeholder value
    }
    setConnectionTestResult(null);
  };

  const testLocalConnection = async () => {
    if (!endpoint) {
      setConnectionTestResult({ success: false, message: 'Please enter an endpoint URL first' });
      return;
    }

    setIsTestingConnection(true);
    setConnectionTestResult(null);
    setError('');
    setSuccess('');

    try {
      // Test connection by calling /v1/models endpoint
      const modelsEndpoint = endpoint.replace('/v1/chat/completions', '/v1/models');
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

      const response = await fetch(modelsEndpoint, {
        method: 'GET',
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        const models = data.data?.map(m => m.id) || [];
        setConnectionTestResult({
          success: true,
          message: `Connection successful! Found ${models.length} model(s)${models.length > 0 ? ': ' + models.slice(0, 3).join(', ') + (models.length > 3 ? '...' : '') : ''}`,
          models
        });
        setSuccess('Local LLM server connection verified!');
      } else {
        setConnectionTestResult({
          success: false,
          message: `Server responded with status ${response.status}`
        });
        setError(`Connection test failed: Server returned ${response.status}`);
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        setConnectionTestResult({
          success: false,
          message: 'Connection timeout - is the server running?'
        });
        setError('Connection timeout. Make sure your local LLM server is running.');
      } else {
        setConnectionTestResult({
          success: false,
          message: `Cannot connect: ${error.message}`
        });
        setError(`Connection failed: ${error.message}`);
      }
    } finally {
      setIsTestingConnection(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');
    setSuccess('');

    try {
      let keyToStore = apiKey.trim();
      // Local providers may not require API keys
      if (!keyToStore && provider !== 'local') {
        if (isEditingExisting && !allowKeyEdit) {
          keyToStore = await apiKeyManager.getAPIKey();
          if (!keyToStore) {
            throw new Error('Stored API key not found. Please enter it manually.');
          }
        } else {
        throw new Error('API key cannot be empty');
        }
      } else if (keyToStore && !apiKeyManager.validateAPIKey(keyToStore)) {
        throw new Error('Invalid API key');
      }
      
      // For local providers without API key, use placeholder
      if (provider === 'local' && !keyToStore) {
        keyToStore = 'local';
      }

      // For custom providers, use the custom name
      const finalProvider = provider === 'custom' ? customProviderName : provider;
      
      // Store the API key with configuration
      await apiKeyManager.storeAPIKey(keyToStore, finalProvider, {
        endpoint: endpoint.trim(),
        model: model.trim(),
        settings: {
          temperature: 0.7,
          max_tokens: 1000
        }
      });
      
              setSuccess(`API key stored successfully for ${finalProvider}`);
      setApiKey('');
      setShowKey(false);
      setAllowKeyEdit(false);
      setIsEditingExisting(false);
      
      // Reload existing key info
      await loadExistingKey();
      await loadRecentModels();
      
      // Notify parent component
      if (onKeySet) {
        onKeySet(provider);
      }
      
      // Auto-close after success
      setTimeout(() => {
        if (onClose) onClose();
      }, 2000);
      
    } catch (error) {
      setError(error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRemoveKey = async () => {
    if (!window.confirm('Are you sure you want to remove your API key? This action cannot be undone.')) {
      return;
    }

    setIsLoading(true);
    setError('');
    setSuccess('');

    try {
      await apiKeyManager.removeAPIKey();
      setExistingKeyInfo(null);
      setIsEditingExisting(false);
      setAllowKeyEdit(true);
      setSuccess('API key removed successfully');
      
      // Notify parent component
      if (onKeySet) {
        onKeySet(null);
      }
      
    } catch (error) {
      setError(error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleTestKey = async () => {
    console.log('[APIKeySetup] Testing API key...');
    setIsValidating(true);
    setError('');
    setSuccess('');

    // Import bridgeFetch once at the top
    const { bridgeFetch } = await import('../../services/bridgeConfig.js');

    try {
      const storedKey = await apiKeyManager.getAPIKey();
      if (!storedKey) {
        throw new Error('No API key found');
      }
      console.log('[APIKeySetup] API key found, testing connection...');

      // Actually test the API connection with a simple request
      const response = await bridgeFetch('/api/ai/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${storedKey}`
        },
        body: JSON.stringify({
          message: 'test',
          context: {
            apiConfig: {
              provider: existingKeyInfo?.provider || 'openrouter',
              endpoint: existingKeyInfo?.endpoint || '',
              model: existingKeyInfo?.model || ''
            }
          }
        })
      });

      console.log('[APIKeySetup] Response status:', response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[APIKeySetup] Test failed:', errorText);
        throw new Error(`API test failed: ${errorText}`);
      }

      const data = await response.json();
      console.log('[APIKeySetup] Response data:', data);
      
      if (data.error) {
        throw new Error(data.error);
      }

      console.log('[APIKeySetup] Test successful!');
      setSuccess('API key works! Connection verified.');
      
      // Send success to chat log
      await bridgeFetch('/api/bridge/chat/append', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          role: 'system', 
          text: 'API Key Test: Connection successful! Your API key is working correctly.',
          channel: 'agent' 
        })
      }).catch(e => console.warn('Failed to send test result to chat:', e));
      
    } catch (error) {
      console.error('[APIKeySetup] Test error:', error);
      setError(`API key test failed: ${error.message}`);
      
      // Send error to chat log
      try {
        await bridgeFetch('/api/bridge/chat/append', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            role: 'system', 
            text: `API Key Test Failed: ${error.message}`,
            channel: 'agent' 
          })
        }).catch(e => console.warn('Failed to send error to chat:', e));
      } catch {}
    } finally {
      setIsValidating(false);
    }
  };

  const formatTimestamp = (timestamp) => {
    return new Date(timestamp).toLocaleString();
  };

  const maskAPIKey = (key) => {
    if (!key) return '';
    return key.substring(0, 8) + '...' + key.substring(key.length - 4);
  };

  const handleRecentModelSelect = (value) => {
    if (!value) return;
    setModel(value);
  };

  const beginEditConfiguration = () => {
    setIsEditingExisting(true);
    setAllowKeyEdit(false);
    setApiKey('');
    setShowKey(false);
    setExistingKeyInfo(null);
  };

  return (
    <div className={`api-key-setup ${inline ? 'api-key-setup-inline' : ''}`}>
      <div className="api-key-header">
        <Key className="api-key-icon" />
        <h3>AI API Configuration</h3>
        {!inline && (
          <button className="close-button" onClick={onClose}>
            ×
          </button>
        )}
        {inline && (
          <button className="collapse-button" onClick={onClose}>
            <Settings size={16} />
          </button>
        )}
      </div>

      {existingKeyInfo && (
        <div className="existing-key-info">
          <div className="key-status">
            <CheckCircle className="status-icon success" />
            <span>API key configured</span>
          </div>
          <div className="key-details">
            <strong>Provider:</strong> {existingKeyInfo.provider}
            <br />
            <strong>Endpoint:</strong> {existingKeyInfo.endpoint}
            <br />
            <strong>Model:</strong> {existingKeyInfo.model}
            <br />
            <strong>Added:</strong> {formatTimestamp(existingKeyInfo.timestamp)}
            {existingKeyInfo.isLegacy && (
              <div className="legacy-notice">
                <br />
                <em>⚠️ Legacy configuration - consider updating to set custom endpoint/model</em>
              </div>
            )}
            {existingKeyInfo.provider === 'openrouter' && existingKeyInfo.model === 'anthropic/claude-3-sonnet-20240229' && (
              <div className="model-warning">
                <br />
                <em>⚠️ Model "anthropic/claude-3-sonnet-20240229" not found on OpenRouter. Please update to a valid model ID like "anthropic/claude-3-sonnet".</em>
              </div>
            )}
          </div>
          <div className="key-actions">
            <button 
              className="update-button"
              onClick={beginEditConfiguration}
            >
              Update Configuration
            </button>
            <button 
              className="test-button"
              onClick={handleTestKey}
              disabled={isValidating}
            >
              {isValidating ? 'Testing...' : 'Test Key'}
            </button>
            <button 
              className="remove-button"
              onClick={handleRemoveKey}
              disabled={isLoading}
            >
              <Trash2 size={16} />
              Remove
            </button>
          </div>
        </div>
      )}

      {!existingKeyInfo && (
        <div className="setup-form">
          <p className="setup-description">
            To use AI features, you need to provide an API key from your preferred AI provider.
            Your key is stored locally in your browser and never sent to our servers.
          </p>

          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="provider">AI Provider</label>
              <select
                id="provider"
                value={provider}
                onChange={(e) => handleProviderChange(e.target.value)}
                disabled={isLoading}
              >
                {providers.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
                <option value="local">💻 Local LLM Server</option>
              </select>
              
              {provider === 'custom' && (
                <div className="form-group">
                  <label htmlFor="customProviderName">Provider Name</label>
                  <input
                    id="customProviderName"
                    type="text"
                    value={customProviderName}
                    onChange={(e) => setCustomProviderName(e.target.value)}
                    placeholder="Enter provider name (e.g., My Custom AI)"
                    disabled={isLoading}
                    className="key-input"
                  />
                </div>
              )}

              {provider === 'local' && (
                <div className="local-providers-section">
                  <p className="section-description">
                    Run models on your own machine for privacy, offline use, and zero API costs.
                  </p>
                  <div className="preset-grid">
                    {localPresets.map(preset => (
                      <button
                        key={preset.id}
                        type="button"
                        className={`preset-button ${selectedPreset?.id === preset.id ? 'selected' : ''}`}
                        onClick={() => handlePresetSelect(preset)}
                        disabled={isLoading}
                      >
                        <div className="preset-name">{preset.name}</div>
                        <div className="preset-port">:{preset.defaultPort}</div>
                      </button>
                    ))}
                  </div>
                  
                  {selectedPreset && (
                    <div className="preset-instructions">
                      <strong>Setup:</strong> {selectedPreset.setupInstructions}
                      {selectedPreset.docsUrl && (
                        <a href={selectedPreset.docsUrl} target="_blank" rel="noopener noreferrer" className="preset-docs-link">
                          Documentation →
                        </a>
                      )}
                    </div>
                  )}

                  <div className="local-config-fields">
                    <div className="form-group">
                      <label htmlFor="localEndpoint">Endpoint URL</label>
                      <input
                        id="localEndpoint"
                        type="text"
                        value={endpoint}
                        onChange={(e) => setEndpoint(e.target.value)}
                        placeholder="http://localhost:11434/v1/chat/completions"
                        disabled={isLoading}
                        className="key-input"
                      />
                      <small className="field-help">
                        OpenAI-compatible endpoint URL (e.g., http://localhost:11434/v1/chat/completions)
                      </small>
                    </div>
                    
                    <div className="form-group">
                      <label htmlFor="localModel">Model Name</label>
                      <input
                        id="localModel"
                        type="text"
                        value={model}
                        onChange={(e) => setModel(e.target.value)}
                        placeholder="llama2"
                        disabled={isLoading}
                        className="key-input"
                      />
                      {selectedPreset?.commonModels.length > 0 && (
                        <div className="model-suggestions">
                          Common models: {selectedPreset.commonModels.join(', ')}
                        </div>
                      )}
                      <small className="field-help">
                        Model name as recognized by your local LLM server
                      </small>
                    </div>
                    
                    <div className="connection-test-section">
                      <button
                        type="button"
                        onClick={testLocalConnection}
                        disabled={isTestingConnection || !endpoint}
                        className="test-connection-button"
                      >
                        {isTestingConnection ? 'Testing...' : 'Test Connection'}
                      </button>
                      {connectionTestResult && (
                        <div className={`connection-test-result ${connectionTestResult.success ? 'success' : 'error'}`}>
                          {connectionTestResult.success ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
                          <span>{connectionTestResult.message}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
              
              {provider !== 'local' && (
                <div className="provider-info">
                  <p>Enter your API key below. The system will store it securely in your browser.</p>
                </div>
              )}
            </div>

            {/* Model Selection - Always show for OpenRouter */}
            {provider === 'openrouter' && (
              <div className="form-group">
                <label htmlFor="model">Model ID</label>
                <input
                  id="model"
                  type="text"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="e.g., anthropic/claude-3-sonnet"
                  disabled={isLoading}
                  className="model-input"
                />
                <small className="field-help">
                  Enter the model ID from OpenRouter. Examples: anthropic/claude-3-sonnet, openai/gpt-4o, google/gemini-pro-1.5
                </small>
              </div>
            )}

            {provider === 'openrouter' && recentModels.length > 0 && (
              <div className="form-group">
                <label htmlFor="recentModel">Recent OpenRouter Models</label>
                <select
                  id="recentModel"
                  className="recent-model-select"
                  value=""
                  onChange={(e) => {
                    handleRecentModelSelect(e.target.value);
                  }}
                >
                  <option value="">Select a recent model…</option>
                  {recentModels.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Advanced Configuration */}
            <div className="form-group">
              <button
                type="button"
                className="advanced-toggle"
                onClick={() => setShowAdvanced(!showAdvanced)}
              >
                <Settings size={16} />
                {showAdvanced ? 'Hide' : 'Show'} Advanced Settings
              </button>
            </div>

            {showAdvanced && (
              <div className="advanced-settings">
                <div className="form-group">
                  <label htmlFor="endpoint">API Endpoint</label>
                  <input
                    id="endpoint"
                    type="url"
                    value={endpoint}
                    onChange={(e) => setEndpoint(e.target.value)}
                    placeholder={`Default: ${apiKeyManager.getDefaultEndpoint(provider)}`}
                    disabled={isLoading}
                    className="endpoint-input"
                  />
                  <small className="field-help">
                    Custom API endpoint URL. Leave empty to use default.
                  </small>
                </div>

                {provider !== 'openrouter' && (
                  <div className="form-group">
                    <label htmlFor="model">Model</label>
                    <input
                      id="model"
                      type="text"
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      placeholder={`Default: ${apiKeyManager.getDefaultModel(provider)}`}
                      disabled={isLoading}
                      className="model-input"
                    />
                    <small className="field-help">
                      Model name/ID to use for API calls. Leave empty to use default.
                    </small>
                  </div>
                )}
              </div>
            )}

            {provider !== 'local' && (
            <div className="form-group">
              <label htmlFor="apiKey">API Key</label>
              {(!isEditingExisting || allowKeyEdit) ? (
              <div className="key-input-container">
                <input
                  id="apiKey"
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="Enter your API key"
                  disabled={isLoading}
                  className="key-input"
                />
                <button
                  type="button"
                  className="toggle-visibility"
                  onClick={() => setShowKey(!showKey)}
                  disabled={isLoading}
                >
                  {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              ) : (
                <div className="key-edit-toggle">
                  <p>This configuration will reuse your existing API key.</p>
                  <button
                    type="button"
                    className="edit-key-button"
                    onClick={() => {
                      setAllowKeyEdit(true);
                      setShowKey(false);
                    }}
                    disabled={isLoading}
                  >
                    Edit API Key
                  </button>
                </div>
              )}
            </div>
            )}

            {provider === 'local' && (
              <div className="form-group">
                <label htmlFor="apiKey">API Key (Optional)</label>
                <div className="key-input-container">
                  <input
                    id="apiKey"
                    type={showKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="Leave empty if not required by your server"
                    disabled={isLoading}
                    className="key-input"
                  />
                  <button
                    type="button"
                    className="toggle-visibility"
                    onClick={() => setShowKey(!showKey)}
                    disabled={isLoading}
                  >
                    {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <small className="field-help">
                  Most local LLM servers don't require API keys. Only enter one if your server requires authentication.
                </small>
              </div>
            )}

            {error && (
              <div className="error-message">
                <AlertCircle size={16} />
                {error}
              </div>
            )}

            {success && (
              <div className="success-message">
                <CheckCircle size={16} />
                {success}
              </div>
            )}

            <div className="form-actions">
              <button
                type="submit"
                disabled={isLoading || ((provider !== 'local') && !apiKey.trim() && !(isEditingExisting && !allowKeyEdit))}
                className="submit-button"
              >
                {isLoading ? 'Storing...' : isEditingExisting ? 'Save Configuration' : provider === 'local' ? 'Save Configuration' : 'Store API Key'}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="security-notice">
        <Settings size={14} />
        <span>
          <strong>Security:</strong> Your API key is stored locally in your browser's localStorage 
          and is obfuscated but not encrypted. Never share your API key with others.
        </span>
      </div>
    </div>
  );
};

export default APIKeySetup; 