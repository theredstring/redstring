/**
 * Agent Config Editor - Edit agent configuration for nodes
 */

import React from 'react';
import { Play, Save, X } from 'lucide-react';

const AgentConfigEditor = ({ config, onChange, onTest, testOutput }) => {
  const [localConfig, setLocalConfig] = React.useState(config || {
    enabled: false,
    prompt: '',
    type: 'executor',
    maxTokens: 8192,
    temperature: 0.7,
    apiKeyOverride: '',
    events: [],
    routes: {}
  });

  React.useEffect(() => {
    if (config) {
      setLocalConfig(config);
    }
  }, [config]);

  const handleChange = (field, value) => {
    const updated = { ...localConfig, [field]: value };
    setLocalConfig(updated);
    onChange?.(updated);
  };

  const handleSave = () => {
    onChange?.(localConfig);
  };

  const handleTest = () => {
    onTest?.(localConfig);
  };

  return (
    <div className="agent-config-editor p-4 space-y-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-lg">Agent Configuration</h3>
        <div className="flex gap-2">
          <button
            onClick={handleTest}
            className="px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 flex items-center gap-1"
            title="Test Agent"
          >
            <Play size={14} />
            Test
          </button>
          <button
            onClick={handleSave}
            className="px-3 py-1 text-sm bg-green-500 text-white rounded hover:bg-green-600 flex items-center gap-1"
            title="Save Configuration"
          >
            <Save size={14} />
            Save
          </button>
        </div>
      </div>

      <div className="space-y-3">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={localConfig.enabled || false}
            onChange={(e) => handleChange('enabled', e.target.checked)}
            className="w-4 h-4"
          />
          <span className="text-sm font-medium">Enable Agent</span>
        </label>

        {localConfig.enabled && (
          <>
            <div>
              <label className="block text-sm font-medium mb-1">Agent Type</label>
              <select
                value={localConfig.type || 'executor'}
                onChange={(e) => handleChange('type', e.target.value)}
                className="w-full p-2 border rounded text-sm"
              >
                <option value="executor">Executor</option>
                <option value="router">Router</option>
                <option value="validator">Validator</option>
                <option value="transformer">Transformer</option>
                <option value="aggregator">Aggregator</option>
                <option value="sensor">Sensor</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">System Prompt</label>
              <textarea
                value={localConfig.prompt || ''}
                onChange={(e) => handleChange('prompt', e.target.value)}
                className="w-full p-2 border rounded text-sm font-mono"
                rows={6}
                placeholder="Enter the agent's system prompt..."
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium mb-1">Max Tokens</label>
                <input
                  type="number"
                  value={localConfig.maxTokens || 8192}
                  onChange={(e) => handleChange('maxTokens', parseInt(e.target.value) || 8192)}
                  className="w-full p-2 border rounded text-sm"
                  min={100}
                  max={8000}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Temperature</label>
                <input
                  type="number"
                  value={localConfig.temperature ?? 0.7}
                  onChange={(e) => handleChange('temperature', parseFloat(e.target.value) || 0.7)}
                  className="w-full p-2 border rounded text-sm"
                  min={0}
                  max={2}
                  step={0.1}
                />
              </div>
            </div>

            {localConfig.type === 'router' && (
              <div>
                <label className="block text-sm font-medium mb-1">Routes (JSON)</label>
                <textarea
                  value={JSON.stringify(localConfig.routes || {}, null, 2)}
                  onChange={(e) => {
                    try {
                      const routes = JSON.parse(e.target.value);
                      handleChange('routes', routes);
                    } catch {
                      // Invalid JSON, ignore
                    }
                  }}
                  className="w-full p-2 border rounded text-sm font-mono"
                  rows={4}
                  placeholder='{"route1": "target-node-id", "route2": "target-node-id"}'
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-medium mb-1">API Key Override (optional)</label>
              <input
                type="password"
                value={localConfig.apiKeyOverride || ''}
                onChange={(e) => handleChange('apiKeyOverride', e.target.value)}
                className="w-full p-2 border rounded text-sm"
                placeholder="Leave empty to use default API key"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Events (comma-separated)</label>
              <input
                type="text"
                value={Array.isArray(localConfig.events) ? localConfig.events.join(', ') : ''}
                onChange={(e) => {
                  const events = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
                  handleChange('events', events);
                }}
                className="w-full p-2 border rounded text-sm"
                placeholder="event1, event2, event3"
              />
            </div>
          </>
        )}
      </div>

      {testOutput && (
        <div className="mt-4 p-3 bg-gray-100 rounded border">
          <div className="text-xs font-medium mb-2">Test Output:</div>
          <pre className="text-xs overflow-auto max-h-40">{JSON.stringify(testOutput, null, 2)}</pre>
        </div>
      )}
    </div>
  );
};

export default AgentConfigEditor;



