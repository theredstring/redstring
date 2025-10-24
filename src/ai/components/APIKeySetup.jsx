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

  const providers = apiKeyManager.getCommonProviders();

  useEffect(() => {
    loadExistingKey();
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
      }
    } catch (error) {
      console.error('Failed to load existing key info:', error);
    }
  };

  const handleProviderChange = (newProvider) => {
    setProvider(newProvider);
    // Auto-set defaults for known providers
    if (newProvider !== 'custom') {
      setEndpoint(apiKeyManager.getDefaultEndpoint(newProvider));
      setModel(apiKeyManager.getDefaultModel(newProvider));
    } else {
      setEndpoint('');
      setModel('');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');
    setSuccess('');

    try {
      // Validate the API key
      if (!apiKeyManager.validateAPIKey(apiKey)) {
        throw new Error('API key cannot be empty');
      }

      // For custom providers, use the custom name
      const finalProvider = provider === 'custom' ? customProviderName : provider;
      
      // Store the API key with configuration
      await apiKeyManager.storeAPIKey(apiKey, finalProvider, {
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
      
      // Reload existing key info
      await loadExistingKey();
      
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
    setIsValidating(true);
    setError('');
    setSuccess('');

    try {
      const storedKey = await apiKeyManager.getAPIKey();
      if (!storedKey) {
        throw new Error('No API key found');
      }

      setSuccess('✅ API key is stored and ready to use!');
      
    } catch (error) {
      setError(`API key check failed: ${error.message}`);
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
              onClick={() => setExistingKeyInfo(null)}
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
              
              <div className="provider-info">
                <p>Enter your API key below. The system will store it securely in your browser.</p>
              </div>
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

            <div className="form-group">
              <label htmlFor="apiKey">API Key</label>
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
            </div>

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
                disabled={isLoading || !apiKey.trim()}
                className="submit-button"
              >
                {isLoading ? 'Storing...' : 'Store API Key'}
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