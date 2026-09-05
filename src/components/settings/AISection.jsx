import React, { useState, useEffect } from 'react';
import { Eye, EyeOff, CheckCircle, AlertCircle, Trash2, RefreshCw, Plug, Save, Pencil, SlidersHorizontal } from 'lucide-react';
import { useTheme } from '../../hooks/useTheme.js';
import PanelIconButton from '../shared/PanelIconButton.jsx';
import apiKeyManager from '../../services/apiKeyManager.js';
import { useProviderModels } from '../../hooks/useProviderModels.js';
import { getProviderLabel } from '../../services/modelCatalog.js';
import debugConfig from '../../utils/debugConfig.js';
import './AISection.css';

/**
 * Read a stored wizard iteration cap, preserving an explicit 0 (= ∞ on the
 * slider). Absent/empty/NaN → default. Number(null) is 0, so the raw string is
 * guarded before coercion.
 */
function readStoredIterations(key, def) {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null || raw === '') return def;
    const n = Number(raw);
    return Number.isFinite(n) ? n : def;
  } catch {
    return def;
  }
}

/**
 * Where the key ends up. It belongs to the field that takes the key, so it sits
 * inside that row above its dividing line rather than floating under the whole
 * form — both key inputs carry it, cloud and local.
 */
const KEY_STORAGE_NOTE = 'API key stored locally in browser localStorage (obfuscated but not encrypted)';

const WIZARD_PREF_OPTIONS = [
  { label: 'Ask each time', value: 'ask' },
  { label: 'New conversation', value: 'new' },
  { label: 'Add to current', value: 'current' }
];

/**
 * The two "what should Ask The Wizard do" choosers, which are the same three
 * options twice. Stacked rather than in a row because the labels are phrases,
 * and stretched so the pills share an edge and read as one group.
 */
const WizardPrefGroup = ({ value, onChange }) => (
  <div className="settings-option-group settings-option-group--stacked">
    {WIZARD_PREF_OPTIONS.map(opt => (
      <PanelIconButton
        key={opt.value}
        label={opt.label}
        labelFontSize={11}
        variant="outline"
        active={value === opt.value}
        onClick={() => onChange(opt.value)}
        style={{ padding: '5px 12px' }}
      />
    ))}
  </div>
);

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
  // Sticky "Custom..." selection: the derived check below can't tell "user picked
  // Custom and hasn't typed yet" from "model is empty", so track it explicitly.
  const [useCustomModel, setUseCustomModel] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [existingKeyInfo, setExistingKeyInfo] = useState(null);
  const [isValidating, setIsValidating] = useState(false);
  const [recentModels, setRecentModels] = useState([]);
  // Providers the user already has a saved key for. The panel edits one active
  // config, so without this a stored key for another provider is invisible.
  const [savedProviders, setSavedProviders] = useState([]);
  const [isEditingExisting, setIsEditingExisting] = useState(false);
  const [allowKeyEdit, setAllowKeyEdit] = useState(true);
  const [localPresets] = useState(() => apiKeyManager.getLocalProviderPresets());
  const [selectedPreset, setSelectedPreset] = useState(null);
  // Preserve an explicit stored 0 (= ∞ on the slider) instead of coercing it back
  // to the default via ||. Absent/empty/NaN → default. (Number(null) is 0, so the
  // raw string is guarded before coercion.)
  const [maxIterationsLocal, setMaxIterationsLocal] = useState(() => readStoredIterations('rs.wizard.maxIterationsLocal', 177));
  const [maxIterationsCloud, setMaxIterationsCloud] = useState(() => readStoredIterations('rs.wizard.maxIterationsCloud', 77));
  const [connectionTestResult, setConnectionTestResult] = useState(null);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [wizardConnectionPref, setWizardConnectionPref] = useState(() => {
    try { return debugConfig.getWizardConnectionPref(); } catch { return 'ask'; }
  });
  const [wizardNodePref, setWizardNodePrefLocal] = useState(() => {
    try { return debugConfig.getWizardNodePref(); } catch { return 'ask'; }
  });

  useEffect(() => {
    const handler = (newConfig) => {
      const nextConn = newConfig?.wizardConnectionPref;
      if (nextConn && nextConn !== wizardConnectionPref) {
        setWizardConnectionPref(nextConn);
      }
      const nextNode = newConfig?.wizardNodePref;
      if (nextNode && nextNode !== wizardNodePref) {
        setWizardNodePrefLocal(nextNode);
      }
    };
    return debugConfig.addListener(handler);
  }, [wizardConnectionPref, wizardNodePref]);

  const handleWizardPrefChange = (value) => {
    setWizardConnectionPref(value);
    try { debugConfig.setWizardConnectionPref(value); } catch (err) {
      console.error('Failed to persist wizard connection pref:', err);
    }
  };

  const handleWizardNodePrefChange = (value) => {
    setWizardNodePrefLocal(value);
    try { debugConfig.setWizardNodePref(value); } catch (err) {
      console.error('Failed to persist wizard node pref:', err);
    }
  };

  const providers = apiKeyManager.getCommonProviders();
  // Live model list from the provider's own models endpoint, with a static
  // fallback — hand-maintained lists go stale within weeks.
  const { models: providerModels, isLive, isLoading: isLoadingModels, needsKey: modelsNeedKey, refresh: refreshModels } =
    useProviderModels(provider, apiKey, endpoint, model);
  // Custom either because the user picked "Custom...", or because the stored model
  // isn't one of the provider's presets (e.g. restored from a saved key).
  const isCustomModel = useCustomModel || (!!model && !providerModels.some(m => m.id === model));

  // Load existing key and recent models on mount
  useEffect(() => {
    loadExistingKey();
    loadRecentModels();
    loadSavedProviders();
  }, []);

  const loadExistingKey = async () => {
    try {
      const keyInfo = await apiKeyManager.getAPIKeyInfo();
      if (keyInfo) {
        setExistingKeyInfo(keyInfo);
        setProvider(keyInfo.provider);
        setEndpoint(keyInfo.endpoint || '');
        setModel(keyInfo.model || '');
        setUseCustomModel(false);
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

  const loadSavedProviders = async () => {
    try {
      const profiles = await apiKeyManager.listProfiles();
      setSavedProviders([...new Set((profiles || []).map(p => p.provider).filter(Boolean))]);
    } catch (err) {
      console.warn('Failed to list saved API key profiles:', err);
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
    setUseCustomModel(false);
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
    setUseCustomModel(false);
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
          max_tokens: 8192,
        }
      });

      setSuccess(`API key stored successfully for ${finalProvider}`);
      setApiKey('');
      setShowKey(false);
      setAllowKeyEdit(false);
      setIsEditingExisting(false);

      await loadExistingKey();
      await loadRecentModels();
      await loadSavedProviders();

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

    try {
      const storedKey = await apiKeyManager.getAPIKey();
      if (!storedKey) {
        throw new Error('No API key found');
      }

      // Calls the provider directly. This used to go through the bridge's
      // /api/ai/chat, which meant "test key" failed whenever no server was
      // running — reporting a bad key when the key was fine.
      const { callLLM } = await import('../../wizard/LLMClient.js');
      await callLLM(
        [{ role: 'user', content: 'test' }],
        [],
        {
          apiKey: storedKey,
          provider: existingKeyInfo?.provider || 'openrouter',
          endpoint: existingKeyInfo?.endpoint || '',
          model: existingKeyInfo?.model || '',
          maxTokens: 16
        }
      );

      setSuccess('API key works! Connection verified.');

      // Best-effort mirror into the bridge chat log; absent on web/iOS.
      const { bridgeFetch } = await import('../../services/bridgeConfig.js');
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
        const { bridgeFetch } = await import('../../services/bridgeConfig.js');
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
    setUseCustomModel(false);
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
      <div className="settings-section-subtitle">API Configuration</div>

      {/* Existing Key Status */}
      {existingKeyInfo && (
        <>
          <div className="settings-row">
            <div className="settings-row-label">
              <div style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                backgroundColor: theme.alert.success.bg,
                color: theme.alert.success.text,
                padding: '6px 10px',
                borderRadius: '6px'
              }}>
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
            <PanelIconButton
              icon={Plug}
              size={14}
              label={isValidating ? 'Testing...' : 'Test API Key'}
              labelFontSize={11}
              variant="outline"
              onClick={handleTestKey}
              disabled={isValidating}
            />
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
            {/* Remove is not colour-coded. Destructive actions in the panel
                wear the same ghost/outline as everything else — the maroon
                hover ring is the only emphasis in this language. */}
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <PanelIconButton
                icon={Pencil}
                size={14}
                label="Update"
                labelFontSize={11}
                variant="solid"
                onClick={beginEditConfiguration}
              />
              <PanelIconButton
                icon={Trash2}
                size={14}
                label="Remove"
                labelFontSize={11}
                variant="outline"
                onClick={handleRemoveKey}
                disabled={isLoading}
              />
            </div>
          </div>
        </>
      )}

      {/* Configuration Form */}
      {!existingKeyInfo && (
        <div>

          {/* Provider Selection */}
          <div className="settings-row">
            <div className="settings-row-label">
              Provider
              <div className="settings-row-description">
                {savedProviders.length > 1
                  ? 'AI service to use — switching keeps each saved key'
                  : 'AI service to use'}
              </div>
            </div>
            <select
              value={provider}
              onChange={(e) => handleProviderChange(e.target.value)}
              disabled={isLoading}
              className="modal-input"
            >
              {providers.map(p => (
                <option key={p.id} value={p.id}>
                  {savedProviders.includes(p.id) ? `${p.name} — key saved` : p.name}
                </option>
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
                className="modal-input"
              />
            </div>
          )}

          {/* Local LLM Presets */}
          {provider === 'local' && (
            <>
              <div className="settings-section-subtitle">Local Server Presets</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '8px' }}>
                {localPresets.map(preset => (
                  <PanelIconButton
                    key={preset.id}
                    label={
                      <>
                        {preset.name}{' '}
                        <span style={{ opacity: 0.7 }}>:{preset.defaultPort}</span>
                      </>
                    }
                    labelFontSize={11}
                    variant="outline"
                    active={selectedPreset?.id === preset.id}
                    onClick={() => handlePresetSelect(preset)}
                    disabled={isLoading}
                    title={`${preset.name} on port ${preset.defaultPort}`}
                    style={{ padding: '5px 12px' }}
                  />
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
                  className="modal-input"
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
                  className="modal-input"
                />
              </div>

              {/* Suggestions are choices, so they get pills like every other
                  choice in the modal rather than a run of underlined text. */}
              {selectedPreset?.commonModels.length > 0 && (
                <div style={{ fontSize: '0.7rem', color: theme.canvas.textSecondary, paddingBottom: '10px', borderBottom: `1px solid ${theme.canvas.border}` }}>
                  <div style={{ marginBottom: '6px' }}>Suggested models</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                    {selectedPreset.commonModels.map(m => (
                      <PanelIconButton
                        key={m}
                        label={m}
                        labelFontSize={11}
                        variant="outline"
                        active={model === m}
                        onClick={() => setModel(m)}
                        style={{ padding: '4px 12px' }}
                      />
                    ))}
                  </div>
                </div>
              )}

              <div className="settings-row" style={{ borderBottom: 'none' }}>
                <div className="settings-row-label">Test Connection</div>
                <PanelIconButton
                  icon={Plug}
                  size={14}
                  label={isTestingConnection ? 'Testing...' : 'Test'}
                  labelFontSize={11}
                  variant="outline"
                  onClick={testLocalConnection}
                  disabled={isTestingConnection || !endpoint}
                />
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
                <div className="settings-row-description">
                  {isLoadingModels
                    ? `Loading ${getProviderLabel(provider)}'s current models…`
                    : isLive
                      ? `Live from ${getProviderLabel(provider)}, newest first`
                      : modelsNeedKey
                        ? savedProviders.includes(provider)
                          ? `Your saved ${getProviderLabel(provider)} key is stored — re-enter it above to load current models`
                          : `Add your ${getProviderLabel(provider)} key above to load current models`
                        : `Couldn't reach ${getProviderLabel(provider)} — showing a short built-in list`}
                </div>
              </div>
              {/* flex 1 1 0 so this column claims the same half of the row as a
                  bare field would — see `.settings-row > .modal-input`. */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: '1 1 0', minWidth: 0 }}>
                {providerModels.length > 0 ? (
                  <>
                    <select
                      value={isCustomModel ? 'custom' : model}
                      onChange={(e) => {
                        if (e.target.value === 'custom') {
                          setUseCustomModel(true);
                          setModel('');
                        } else {
                          setUseCustomModel(false);
                          setModel(e.target.value);
                        }
                      }}
                      disabled={isLoading}
                      className="modal-input"
                    >
                      {providerModels.map(m => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                      ))}
                      <option value="custom">Custom...</option>
                    </select>

                    <PanelIconButton
                      icon={RefreshCw}
                      size={12}
                      label="Refresh models"
                      labelFontSize={11}
                      variant="outline"
                      onClick={refreshModels}
                      disabled={isLoadingModels}
                      title="Re-fetch the model list (cached for 24h)"
                      style={{ alignSelf: 'flex-start' }}
                    />

                    {isCustomModel && (
                      <input
                        type="text"
                        value={model}
                        onChange={(e) => setModel(e.target.value)}
                        placeholder="gpt-4o"
                        disabled={isLoading}
                        className="modal-input"
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
                    className="modal-input"
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
                className="modal-input"
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
                  className="modal-input"
                  style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}
                />
              </div>
            </>
          )}

          {provider !== 'local' && !showAdvanced && (
            <div className="settings-row">
              <div className="settings-row-label"></div>
              <PanelIconButton
                icon={SlidersHorizontal}
                size={13}
                label="Show advanced settings"
                labelFontSize={11}
                onClick={() => setShowAdvanced(true)}
              />
            </div>
          )}

          {/* API Key Input */}
          {provider !== 'local' && (
            <div className="settings-row">
              <div className="settings-row-label">
                API Key
                <div className="settings-row-description">Your provider key</div>
                <div className="settings-row-description">{KEY_STORAGE_NOTE}</div>
              </div>
              {(!isEditingExisting || allowKeyEdit) ? (
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center', flex: '1 1 0', minWidth: 0 }}>
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
                    className="modal-input"
                    style={{ paddingRight: '40px' }}
                  />
                  <PanelIconButton
                    icon={showKey ? EyeOff : Eye}
                    size={16}
                    onClick={() => setShowKey(!showKey)}
                    disabled={isLoading}
                    title={showKey ? 'Hide key' : 'Show key'}
                    style={{ position: 'absolute', right: '6px' }}
                  />
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.75rem', color: theme.canvas.textSecondary }}>
                  Using existing key
                  <PanelIconButton
                    icon={Pencil}
                    size={13}
                    label="Edit"
                    labelFontSize={11}
                    variant="outline"
                    onClick={() => { setAllowKeyEdit(true); setShowKey(false); }}
                    style={{ padding: '4px 12px' }}
                  />
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
                <div className="settings-row-description">{KEY_STORAGE_NOTE}</div>
              </div>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center', flex: '1 1 0', minWidth: 0 }}>
                <input
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="Optional"
                  disabled={isLoading}
                  className="modal-input"
                  style={{ paddingRight: '40px' }}
                />
                <PanelIconButton
                  icon={showKey ? EyeOff : Eye}
                  size={16}
                  onClick={() => setShowKey(!showKey)}
                  title={showKey ? 'Hide key' : 'Show key'}
                  style={{ position: 'absolute', right: '6px' }}
                />
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
            {/* The section's one primary action, so it takes the solid variant
                — the same weight the panel gives "New" in the universe list. */}
            <PanelIconButton
              icon={Save}
              size={14}
              label={isLoading ? 'Saving...' : isEditingExisting ? 'Save' : 'Store API Key'}
              labelFontSize={12}
              variant="solid"
              onClick={handleSubmit}
              disabled={isLoading || ((provider !== 'local') && !apiKey.trim() && !(isEditingExisting && !allowKeyEdit))}
              style={{ padding: '8px 20px' }}
            />
          </div>
        </div>
      )}

      <hr className="settings-section-divider" />

      {/* Wizard Behavior */}
      <div className="settings-section-subtitle">Wizard Behavior</div>

      <div className="settings-row">
        <div className="settings-row-label">
          Local model iterations
          <div className="settings-row-description">Max tool calls per turn for local/small models. 0 = max (capped at 300)</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <input
            type="range"
            min="0"
            max="500"
            step="1"
            value={maxIterationsLocal}
            onChange={(e) => { const v = Number(e.target.value); setMaxIterationsLocal(v); localStorage.setItem('rs.wizard.maxIterationsLocal', v); }}
            style={{ flex: 1, minWidth: '100px' }}
          />
          <span style={{ minWidth: '32px', textAlign: 'right', fontSize: '0.8rem' }}>
            {maxIterationsLocal === 0 ? '∞' : maxIterationsLocal}
          </span>
        </div>
      </div>

      <div className="settings-row">
        <div className="settings-row-label">
          Cloud model iterations
          <div className="settings-row-description">Max tool calls per turn for cloud models. 0 = max (capped at 100)</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <input
            type="range"
            min="0"
            max="200"
            step="1"
            value={maxIterationsCloud}
            onChange={(e) => { const v = Number(e.target.value); setMaxIterationsCloud(v); localStorage.setItem('rs.wizard.maxIterationsCloud', v); }}
            style={{ flex: 1, minWidth: '100px' }}
          />
          <span style={{ minWidth: '32px', textAlign: 'right', fontSize: '0.8rem' }}>
            {maxIterationsCloud === 0 ? '∞' : maxIterationsCloud}
          </span>
        </div>
      </div>

      <div className="settings-row">
        <div className="settings-row-label">
          Connection Wizard
          <div className="settings-row-description">
            What should happen when you click "Ask The Wizard" on a connection
          </div>
        </div>
        <WizardPrefGroup value={wizardConnectionPref} onChange={handleWizardPrefChange} />
      </div>
      <div className="settings-row">
        <div className="settings-row-label">
          Define Node Wizard
          <div className="settings-row-description">
            What should happen when you click "Ask The Wizard" on a node with no components
          </div>
        </div>
        <WizardPrefGroup value={wizardNodePref} onChange={handleWizardNodePrefChange} />
      </div>
    </div>
  );
};

export default AISection;
