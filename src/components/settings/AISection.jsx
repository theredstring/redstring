import React, { useState, useEffect } from 'react';
import { Eye, EyeOff, CheckCircle, AlertCircle, Trash2 } from 'lucide-react';
import { useTheme } from '../../hooks/useTheme.js';
import apiKeyManager from '../../services/apiKeyManager.js';
import './AISection.css';

/**
 * AI Settings Section - Adapted to Settings Modal patterns
 * Uses settings-row, selects, and inline controls
 */
const AISection = () => {
  const theme = useTheme();
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
  const providerModels = apiKeyManager.getModelsForProvider(provider);

  // Load existing key and recent models on mount
  useEffect(() => {
    loadExistingKey();
    loadRecentModels();
  }, []);

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
        setEndpoint(apiKeyManager.getDefaultEndpoint(provider));
        setModel(apiKeyManager.getDefaultModel(provider));
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
    if (newProvider !== 'custom') {
      const defaultEndpoint = apiKeyManager.getDefaultEndpoint(newProvider);
      const defaultModel = apiKeyManager.getDefaultModel(newProvider);
      setEndpoint(defaultEndpoint);
      setModel(defaultModel);
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
      setApiKey('local');
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
      const modelsEndpoint = endpoint.replace('/v1/chat/completions', '/v1/models');
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

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

      if (provider === 'local' && !keyToStore) {
        keyToStore = 'local';
      }

      const finalProvider = provider === 'custom' ? customProviderName : provider;

      await apiKeyManager.storeAPIKey(keyToStore, finalProvider, {
        endpoint: endpoint.trim(),
        model: model.trim(),
        settings: {
          temperature: 0.7,
          max_tokens: 8192
        }
      });

      setSuccess(`API key stored successfully for ${finalProvider}`);
      setApiKey('');
      setShowKey(false);
      setAllowKeyEdit(false);
      setIsEditingExisting(false);

      await loadExistingKey();
      await loadRecentModels();

      // Dispatch event to notify LeftAIView
      window.dispatchEvent(new Event('aiKeyConfigChanged'));

      // Clear success message after 3 seconds
      setTimeout(() => setSuccess(''), 3000);
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

      // Dispatch event to notify LeftAIView
      window.dispatchEvent(new Event('aiKeyConfigChanged'));

      setTimeout(() => setSuccess(''), 3000);
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

    const { bridgeFetch } = await import('../../services/bridgeConfig.js');

    try {
      const storedKey = await apiKeyManager.getAPIKey();
      if (!storedKey) {
        throw new Error('No API key found');
      }

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

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API test failed: ${errorText}`);
      }

      const data = await response.json();

      if (data.error) {
        throw new Error(data.error);
      }

      setSuccess('API key works! Connection verified.');

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
      setError(`API key test failed: ${error.message}`);

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
      } catch { }
    } finally {
      setIsValidating(false);
    }
  };

  const formatTimestamp = (timestamp) => {
    return new Date(timestamp).toLocaleString();
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
    <div>
      {/* Existing Key Status */}
      {existingKeyInfo && (
        <>
          <div className="settings-row">
            <div className="settings-row-label">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: theme.alert.success.text }}>
                <CheckCircle size={16} />
                <span>API Key Configured</span>
              </div>
            </div>
          </div>

          <div className="settings-row">
            <div className="settings-row-label">Provider</div>
            <div className="ai-value">{existingKeyInfo.provider}</div>
          </div>

          <div className="settings-row">
            <div className="settings-row-label">Model</div>
            <div className="ai-value">{existingKeyInfo.model}</div>
          </div>

          <div className="settings-row">
            <div className="settings-row-label">
              Endpoint
              <div className="settings-row-description" style={{ fontSize: '0.7rem', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                {existingKeyInfo.endpoint}
              </div>
            </div>
          </div>

          <div className="settings-row">
            <div className="settings-row-label">Test Connection</div>
            <button className="ai-action-btn ai-btn-primary" onClick={handleTestKey} disabled={isValidating} style={{ minWidth: '100px' }}>
              {isValidating ? 'Testing...' : 'Test API Key'}
            </button>
          </div>

          {/* Test result messages */}
          {error && (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '10px', backgroundColor: theme.alert.error.bg, color: theme.alert.error.text, border: `1px solid ${theme.alert.error.border}`, borderRadius: '6px', fontSize: '0.8rem', margin: '0 0 12px 0', overflow: 'hidden' }}>
              <AlertCircle size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
              <span style={{ wordBreak: 'break-word', overflowWrap: 'anywhere', minWidth: 0 }}>{error}</span>
            </div>
          )}

          {success && (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '10px', backgroundColor: theme.alert.success.bg, color: theme.alert.success.text, border: `1px solid ${theme.alert.success.border}`, borderRadius: '6px', fontSize: '0.8rem', margin: '0 0 12px 0', overflow: 'hidden' }}>
              <CheckCircle size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
              <span style={{ wordBreak: 'break-word', overflowWrap: 'anywhere', minWidth: 0 }}>{success}</span>
            </div>
          )}

          <div className="settings-row" style={{ borderBottom: 'none', paddingBottom: '0' }}>
            <div className="settings-row-label">Actions</div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button className="ai-action-btn ai-btn-secondary" onClick={beginEditConfiguration}>
                Update
              </button>
              <button className="ai-action-btn ai-btn-danger" onClick={handleRemoveKey} disabled={isLoading}>
                Remove
              </button>
            </div>
          </div>

          <hr className="settings-section-divider" />
        </>
      )}

      {/* Configuration Form */}
      {!existingKeyInfo && (
        <div>

          {/* Provider Selection */}
          <div className="settings-row">
            <div className="settings-row-label">
              Provider
              <div className="settings-row-description">AI service to use</div>
            </div>
            <select
              value={provider}
              onChange={(e) => handleProviderChange(e.target.value)}
              disabled={isLoading}
              className="ai-input"
            >
              {providers.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
              <option value="local">Local LLM Server</option>
            </select>
          </div>

          {/* Custom Provider Name */}
          {provider === 'custom' && (
            <div className="settings-row">
              <div className="settings-row-label">
                Provider Name
                <div className="settings-row-description">Custom name</div>
              </div>
              <input
                type="text"
                value={customProviderName}
                onChange={(e) => setCustomProviderName(e.target.value)}
                placeholder="My Custom AI"
                disabled={isLoading}
                className="ai-input"
              />
            </div>
          )}

          {/* Local LLM Presets */}
          {provider === 'local' && (
            <>
              <div className="settings-section-subtitle">Local Server Presets</div>
              <div className="settings-option-group" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', display: 'grid', gap: '6px' }}>
                {localPresets.map(preset => (
                  <button
                    key={preset.id}
                    type="button"
                    className={`settings-option-btn ${selectedPreset?.id === preset.id ? 'active' : ''}`}
                    onClick={() => handlePresetSelect(preset)}
                    disabled={isLoading}
                    style={{ padding: '8px 6px', fontSize: '0.7rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}
                  >
                    <div>{preset.name}</div>
                    <div style={{ opacity: 0.7, fontSize: '0.65rem' }}>:{preset.defaultPort}</div>
                  </button>
                ))}
              </div>

              {selectedPreset && (
                <div style={{ fontSize: '0.75rem', color: theme.canvas.textPrimary, padding: '8px 0', borderBottom: `1px solid ${theme.darkMode ? 'rgba(222,218,218,0.1)' : 'rgba(38,0,0,0.08)'}` }}>
                  {selectedPreset.setupInstructions}
                </div>
              )}

              <div className="settings-row">
                <div className="settings-row-label">
                  Endpoint
                  <div className="settings-row-description">Server URL</div>
                </div>
                <input
                  type="text"
                  value={endpoint}
                  onChange={(e) => setEndpoint(e.target.value)}
                  placeholder="http://localhost:11434/v1/chat/completions"
                  disabled={isLoading}
                  className="ai-input"
                  style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}
                />
              </div>

              <div className="settings-row">
                <div className="settings-row-label">
                  Model
                  <div className="settings-row-description">Model name</div>
                </div>
                <input
                  type="text"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="llama2"
                  disabled={isLoading}
                  className="ai-input"
                />
              </div>

              {selectedPreset?.commonModels.length > 0 && (
                <div style={{ fontSize: '0.7rem', color: theme.darkMode ? '#ff9a9a' : '#260000', paddingBottom: '10px', borderBottom: `1px solid ${theme.darkMode ? 'rgba(222,218,218,0.1)' : 'rgba(38,0,0,0.08)'}` }}>
                  Suggested: {selectedPreset.commonModels.map((m, i) => (
                    <React.Fragment key={m}>
                      <button
                        type="button"
                        onClick={() => setModel(m)}
                        style={{ background: 'none', border: 'none', color: theme.darkMode ? '#ff9a9a' : '#260000', textDecoration: 'underline', cursor: 'pointer', padding: 0, font: 'inherit' }}
                      >
                        {m}
                      </button>
                      {i < selectedPreset.commonModels.length - 1 ? ', ' : ''}
                    </React.Fragment>
                  ))}
                </div>
              )}

              <div className="settings-row" style={{ borderBottom: 'none' }}>
                <div className="settings-row-label">Test Connection</div>
                <button
                  type="button"
                  onClick={testLocalConnection}
                  disabled={isTestingConnection || !endpoint}
                  className="ai-action-btn ai-btn-secondary"
                >
                  {isTestingConnection ? 'Testing...' : 'Test'}
                </button>
              </div>

              {connectionTestResult && (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '8px 12px',
                  backgroundColor: connectionTestResult.success ? theme.alert.success.bg : theme.alert.error.bg,
                  color: connectionTestResult.success ? theme.alert.success.text : theme.alert.error.text,
                  border: `1px solid ${connectionTestResult.success ? theme.alert.success.border : theme.alert.error.border}`,
                  borderRadius: '6px',
                  fontSize: '0.75rem',
                  marginBottom: '12px'
                }}>
                  {connectionTestResult.success ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
                  <span>{connectionTestResult.message}</span>
                </div>
              )}

              <hr className="settings-section-divider" />
            </>
          )}

          {/* Model Selection (non-local providers) */}
          {provider !== 'local' && (
            <div className="settings-row">
              <div className="settings-row-label">
                Model
                <div className="settings-row-description">Which model to use</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {providerModels.length > 0 ? (
                  <>
                    <select
                      value={providerModels.some(m => m.id === model) ? model : 'custom'}
                      onChange={(e) => {
                        if (e.target.value !== 'custom') {
                          setModel(e.target.value);
                        }
                      }}
                      disabled={isLoading}
                      className="ai-input"
                    >
                      {providerModels.map(m => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                      ))}
                      <option value="custom">Custom...</option>
                    </select>

                    {(providerModels.every(m => m.id !== model) || model === 'custom') && (
                      <input
                        type="text"
                        value={model === 'custom' ? '' : model}
                        onChange={(e) => setModel(e.target.value)}
                        placeholder="gpt-4o"
                        disabled={isLoading}
                        className="ai-input"
                      />
                    )}
                  </>
                ) : (
                  <input
                    type="text"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder={apiKeyManager.getDefaultModel(provider)}
                    disabled={isLoading}
                    className="ai-input"
                  />
                )}
              </div>
            </div>
          )}

          {/* Recent OpenRouter Models */}
          {provider === 'openrouter' && recentModels.length > 0 && (
            <div className="settings-row">
              <div className="settings-row-label">
                Recent
                <div className="settings-row-description">Previously used models</div>
              </div>
              <select
                value=""
                onChange={(e) => handleRecentModelSelect(e.target.value)}
                className="ai-input"
              >
                <option value="">Select recent...</option>
                {recentModels.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
          )}

          {/* Advanced Settings */}
          {showAdvanced && provider !== 'local' && (
            <>
              <div className="settings-section-subtitle">Advanced</div>
              <div className="settings-row">
                <div className="settings-row-label">
                  Endpoint
                  <div className="settings-row-description">Custom API URL</div>
                </div>
                <input
                  type="url"
                  value={endpoint}
                  onChange={(e) => setEndpoint(e.target.value)}
                  placeholder={apiKeyManager.getDefaultEndpoint(provider)}
                  disabled={isLoading}
                  className="ai-input"
                  style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}
                />
              </div>
            </>
          )}

          {provider !== 'local' && !showAdvanced && (
            <div className="settings-row">
              <div className="settings-row-label"></div>
              <button
                type="button"
                onClick={() => setShowAdvanced(true)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: theme.darkMode ? '#ff9a9a' : '#260000',
                  fontSize: '0.75rem',
                  cursor: 'pointer',
                  textDecoration: 'underline',
                  padding: 0,
                  fontFamily: "'EmOne', sans-serif"
                }}
              >
                Show advanced settings
              </button>
            </div>
          )}

          {/* API Key Input */}
          {provider !== 'local' && (
            <div className="settings-row">
              <div className="settings-row-label">
                API Key
                <div className="settings-row-description">Your provider key</div>
              </div>
              {(!isEditingExisting || allowKeyEdit) ? (
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={(e) => {
                      const newKey = e.target.value;
                      setApiKey(newKey);
                      // Auto-detect provider
                      if (newKey.startsWith('sk-ant-')) handleProviderChange('anthropic');
                      else if (newKey.startsWith('sk-or-')) handleProviderChange('openrouter');
                      else if (newKey.startsWith('sk-proj-')) handleProviderChange('openai');
                    }}
                    placeholder="sk-..."
                    disabled={isLoading}
                    className="ai-input"
                    style={{ paddingRight: '40px' }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    disabled={isLoading}
                    style={{
                      position: 'absolute',
                      right: '8px',
                      background: 'none',
                      border: 'none',
                      color: theme.canvas.textSecondary,
                      cursor: 'pointer',
                      padding: '4px',
                      display: 'flex',
                      alignItems: 'center'
                    }}
                  >
                    {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              ) : (
                <div style={{ fontSize: '0.75rem', color: theme.canvas.textPrimary, fontStyle: 'italic' }}>
                  Using existing key •{' '}
                  <button
                    type="button"
                    onClick={() => { setAllowKeyEdit(true); setShowKey(false); }}
                    style={{ background: 'none', border: 'none', color: theme.darkMode ? '#ff9a9a' : '#260000', textDecoration: 'underline', cursor: 'pointer', padding: 0, font: 'inherit' }}
                  >
                    Edit
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Local API Key (Optional) */}
          {provider === 'local' && (
            <div className="settings-row">
              <div className="settings-row-label">
                API Key
                <div className="settings-row-description">Optional (leave empty if not needed)</div>
              </div>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <input
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="Optional"
                  disabled={isLoading}
                  className="ai-input"
                  style={{ paddingRight: '40px' }}
                />
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  style={{
                    position: 'absolute',
                    right: '8px',
                    background: 'none',
                    border: 'none',
                    color: theme.canvas.textSecondary,
                    cursor: 'pointer',
                    padding: '4px',
                    display: 'flex',
                    alignItems: 'center'
                  }}
                >
                  {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
          )}

          {/* Error/Success Messages */}
          {error && (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '10px', backgroundColor: theme.alert.error.bg, color: theme.alert.error.text, border: `1px solid ${theme.alert.error.border}`, borderRadius: '6px', fontSize: '0.8rem', margin: '12px 0', overflow: 'hidden' }}>
              <AlertCircle size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
              <span style={{ wordBreak: 'break-word', overflowWrap: 'anywhere', minWidth: 0 }}>{error}</span>
            </div>
          )}

          {success && (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '10px', backgroundColor: theme.alert.success.bg, color: theme.alert.success.text, border: `1px solid ${theme.alert.success.border}`, borderRadius: '6px', fontSize: '0.8rem', margin: '12px 0', overflow: 'hidden' }}>
              <CheckCircle size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
              <span style={{ wordBreak: 'break-word', overflowWrap: 'anywhere', minWidth: 0 }}>{success}</span>
            </div>
          )}

          {/* Save Button */}
          <div className="settings-row" style={{ borderBottom: 'none', paddingTop: '20px' }}>
            <div className="settings-row-label"></div>
            <button
              onClick={handleSubmit}
              disabled={isLoading || ((provider !== 'local') && !apiKey.trim() && !(isEditingExisting && !allowKeyEdit))}
              style={{
                padding: '10px 24px',
                backgroundColor: isLoading || ((provider !== 'local') && !apiKey.trim() && !(isEditingExisting && !allowKeyEdit))
                  ? (theme.darkMode ? 'rgba(222,218,218,0.15)' : 'rgba(38,0,0,0.2)')
                  : (theme.darkMode ? theme.canvas.border : '#260000'),
                color: theme.darkMode ? '#DEDADA' : '#fff',
                border: 'none',
                borderRadius: '6px',
                fontSize: '0.85rem',
                fontWeight: '500',
                cursor: isLoading ? 'not-allowed' : 'pointer',
                fontFamily: "'EmOne', sans-serif"
              }}
            >
              {isLoading ? 'Saving...' : isEditingExisting ? 'Save' : 'Store API Key'}
            </button>
          </div>
        </div>
      )}

      {/* Security Notice */}
      <div style={{
        fontSize: '0.7rem',
        color: theme.alert.warning.text,
        backgroundColor: theme.alert.warning.bg,
        padding: '10px',
        borderRadius: '6px',
        marginTop: '20px',
        borderLeft: `3px solid ${theme.alert.warning.border}`
      }}>
        <strong>Note:</strong> API key stored locally in browser localStorage (obfuscated, not encrypted)
      </div>
    </div>
  );
};

export default AISection;
