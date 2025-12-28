import React from 'react';
import { Bot, Key, Settings, RotateCcw, Send, User, Square, Copy, Trash2, Brain } from 'lucide-react';
import APIKeySetup from '../../../ai/components/APIKeySetup.jsx';
import mcpClient from '../../../services/mcpClient.js';
import apiKeyManager from '../../../services/apiKeyManager.js';
import { bridgeFetch, bridgeEventSource } from '../../../services/bridgeConfig.js';
import StandardDivider from '../../StandardDivider.jsx';
import { HEADER_HEIGHT } from '../../../constants.js';
import ToolCallCard from '../../ToolCallCard.jsx';
import DruidMindPanel from '../../DruidMindPanel.jsx';
import DruidInstance from '../../../services/agent/DruidInstance.js';

// Internal AI Collaboration View component (migrated from src/ai/AICollaborationPanel.jsx)
const LeftAIView = ({ compact = false, activeGraphId, graphsMap }) => {
  const [isConnected, setIsConnected] = React.useState(false);
  const [messages, setMessages] = React.useState([]);
  const [currentInput, setCurrentInput] = React.useState('');
  const [isProcessing, setIsProcessing] = React.useState(false);
  const [showAdvanced, setShowAdvanced] = React.useState(false);
  const [showAPIKeySetup, setShowAPIKeySetup] = React.useState(false);
  const [hasAPIKey, setHasAPIKey] = React.useState(false);
  const [apiKeyInfo, setApiKeyInfo] = React.useState(null);
  const [isAutonomousMode, setIsAutonomousMode] = React.useState(true);
  const [currentAgentRequest, setCurrentAgentRequest] = React.useState(null);
  const [showDruidMind, setShowDruidMind] = React.useState(false);
  const [druidInstance, setDruidInstance] = React.useState(null);
  const [wizardStage, setWizardStage] = React.useState(null); // Track current wizard stage
  const messagesEndRef = React.useRef(null);
  const inputRef = React.useRef(null);

  const STORAGE_KEY = 'rs.aiChat.messages.v1';
  const RESET_TS_KEY = 'rs.aiChat.resetTs';

  // Use the existing subscriptions from the main section to prevent Panel jitter
  // activeGraphId and graphsMap are already available from the main subscriptions

  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  React.useEffect(() => {
    try {
      if (mcpClient && mcpClient.isConnected) setIsConnected(true);
    } catch { }
    let resetTs = 0;
    try {
      const cached = localStorage.getItem(STORAGE_KEY);
      const rt = localStorage.getItem(RESET_TS_KEY);
      resetTs = rt ? Number(rt) || 0 : 0;
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed)) setMessages(parsed);
      }
    } catch { }
    (async () => {
      try {
        const res = await bridgeFetch('/api/bridge/telemetry');
        if (!res.ok) return;
        const data = await res.json();
        const chat = Array.isArray(data?.chat) ? data.chat : [];
        if (chat.length === 0) return;
        const hydrated = chat
          .filter((c) => !resetTs || (typeof c.ts === 'number' && c.ts >= resetTs))
          .map((c) => ({
            id: `${c.ts || Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
            sender: c.role === 'user' ? 'user' : c.role === 'ai' ? 'ai' : 'system',
            content: c.text || '',
            timestamp: new Date(c.ts || Date.now()).toISOString(),
            metadata: {}
          }));
        setMessages((prev) => (prev.length === 0 ? hydrated : prev));
      } catch (error) {
        console.warn('[AI Collaboration] Failed to hydrate bridge telemetry:', error);
      }
    })();

    // CRITICAL: Subscribe to SSE for real-time chat updates (e.g., executor errors)
    let eventSource;
    try {
      eventSource = bridgeEventSource('/events/stream');

      eventSource.addEventListener('chat', (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('[AI Collaboration] Received chat event:', data);

          // Add message to chat immediately (real-time update)
          setMessages(prev => {
            // Check if message already exists (avoid duplicates)
            const alreadyExists = prev.some(m =>
              Math.abs(new Date(m.timestamp).getTime() - data.ts) < 1000 && m.content === data.text
            );

            if (alreadyExists) return prev;

            // Add new message
            const newMessage = {
              id: `${data.ts || Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
              sender: data.role === 'user' ? 'user' : data.role === 'ai' ? 'ai' : 'system',
              content: data.text || '',
              timestamp: new Date(data.ts || Date.now()).toISOString(),
              metadata: data,
              toolCalls: []
            };

            return [...prev, newMessage];
          });
        } catch (err) {
          console.warn('[AI Collaboration] Failed to process chat event:', err);
        }
      });

      eventSource.onerror = (err) => {
        console.warn('[AI Collaboration] SSE error:', err);
      };
    } catch (err) {
      console.warn('[AI Collaboration] Failed to establish SSE:', err);
    }

    return () => {
      if (eventSource) {
        try {
          eventSource.close();
        } catch (err) {
          console.warn('[AI Collaboration] Failed to close SSE:', err);
        }
      }
    };
  }, []);

  React.useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(messages)); } catch { }
  }, [messages]);

  React.useEffect(() => { checkAPIKey(); }, []);
  const checkAPIKey = async () => {
    try {
      const hasKey = await apiKeyManager.hasAPIKey();
      const keyInfo = await apiKeyManager.getAPIKeyInfo();
      setHasAPIKey(hasKey);
      setApiKeyInfo(keyInfo);
    } catch (error) { console.error('Failed to check API key:', error); }
  };

  const addMessage = (sender, content, metadata = {}) => {
    // Check for duplicates before adding
    setMessages(prev => {
      // Check if this exact message already exists (same sender, content, and recent timestamp)
      const isDuplicate = prev.some(m =>
        m.sender === sender &&
        m.content === content &&
        Math.abs(new Date(m.timestamp).getTime() - Date.now()) < 2000 // Within 2 seconds
      );
      if (isDuplicate) {
        console.log('[AI Collaboration] Skipping duplicate message:', content.substring(0, 50));
        return prev;
      }

      const message = {
        id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        sender,
        content,
        timestamp: new Date().toISOString(),
        metadata,
        toolCalls: (metadata.toolCalls || []).map(tc => ({ ...tc, expanded: false }))
      };
      return [...prev, message];
    });
  };

  // Simple markdown renderer for system messages (supports **bold** and basic formatting)
  const renderMarkdown = (text) => {
    if (!text) return text;

    // Replace **bold** with <strong>
    let html = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

    // Replace newlines with <br>
    html = html.replace(/\n/g, '<br>');

    return html;
  };

  const upsertToolCall = (toolUpdate) => {
    setMessages(prev => {
      const updated = [...prev];
      let idx = updated.length - 1;
      while (idx >= 0 && updated[idx].sender !== 'ai') idx--;
      if (idx < 0) {
        updated.push({ id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`, sender: 'ai', content: '', timestamp: new Date().toISOString(), toolCalls: [] });
        idx = updated.length - 1;
      }
      const msg = { ...updated[idx] };
      const calls = Array.isArray(msg.toolCalls) ? [...msg.toolCalls] : [];
      const matchIndex = calls.findIndex(c => (toolUpdate.id && c.id === toolUpdate.id)
        || (toolUpdate.cid && c.cid === toolUpdate.cid && c.name === toolUpdate.name)
        || (!toolUpdate.cid && c.name === toolUpdate.name));
      if (matchIndex >= 0) {
        calls[matchIndex] = { ...calls[matchIndex], ...toolUpdate };
      } else {
        calls.push({ expanded: false, status: toolUpdate.status || 'running', ...toolUpdate });
      }
      msg.toolCalls = calls;
      updated[idx] = msg;
      return updated;
    });
  };

  React.useEffect(() => {
    const handler = (e) => {
      const items = Array.isArray(e.detail) ? e.detail : [];
      items.forEach((t) => {
        // Handle wizard stage updates
        if (t.type === 'wizard_stage') {
          if (t.status === 'start') {
            setWizardStage({ stage: t.stage, toolName: t.data?.toolName });
          } else if (t.status === 'success' || t.status === 'error') {
            setWizardStage(null); // Clear stage when complete
          }
          return;
        }
        if (t.type === 'tool_call') {
          const status = t.status || (t.leased ? 'running' : 'running');
          upsertToolCall({
            id: t.id,
            name: t.name || 'tool',
            status,
            args: t.args,
            result: t.result,
            error: t.error,
            executionTime: t.executionTime,
            timestamp: t.ts,
            cid: t.cid
          });
          return;
        }
        if (t.type === 'agent_queued') {
          if (messages.length > 0) upsertToolCall({ name: 'agent', status: 'queued', args: { queued: t.queued, graphId: t.graphId }, cid: t.cid });
          return;
        }
        if (t.type === 'info') {
          upsertToolCall({ name: t.name || 'info', status: 'completed', result: t.message, cid: t.cid });
          return;
        }
        if (t.type === 'agent_answer') {
          const finalText = (t.text || '').trim();
          setMessages(prev => {
            const isDefault = /\bwhat will we (make|build) today\?/i.test(finalText);
            if (prev.length === 0 && isDefault) return prev;
            const updated = [...prev];
            let idx = updated.length - 1;
            while (idx >= 0 && updated[idx].sender !== 'ai') idx--;
            if (idx >= 0) {
              const currentContent = updated[idx].content || '';
              // Avoid duplicating if the text is already at the end
              if (!currentContent.endsWith(finalText)) {
                updated[idx] = {
                  ...updated[idx],
                  content: currentContent ? `${currentContent}\n${finalText}` : finalText
                };
              }
              return updated;
            }
            if (updated.length === 0 && isDefault) return updated;
            return [...updated, { id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`, sender: 'ai', content: finalText, timestamp: new Date().toISOString(), toolCalls: [] }];
          });
          return;
        }
      });
    };
    window.addEventListener('rs-telemetry', handler);
    return () => window.removeEventListener('rs-telemetry', handler);
  }, []);

  React.useEffect(() => {
    if (hasAPIKey && !isConnected && !isProcessing) {
      if (mcpClient && mcpClient.isConnected) { setIsConnected(true); return; }
      initializeConnection();
    }
  }, [hasAPIKey]);

  const initializeConnection = async () => {
    try {
      setIsProcessing(true);
      await mcpClient.connect();
      setIsConnected(true);
    } catch (error) {
      console.error('[AI Collaboration] Connection failed:', error);
      setIsConnected(false);
      addMessage('system', `Connection failed: ${error.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // Bridge connection refresh disabled
  const refreshBridgeConnection = async () => {
    try {
      setIsProcessing(true);
      const [healthRes, stateRes] = await Promise.all([
        bridgeFetch('/api/bridge/health').catch((error) => { throw new Error(error.message || 'Bridge health request failed'); }),
        bridgeFetch('/api/bridge/state').catch(() => null)
      ]);

      if (!healthRes || !healthRes.ok) {
        throw new Error('Bridge daemon is unreachable. Make sure it is running on :3001.');
      }
      const health = await healthRes.json();
      let summary = `Bridge daemon online (${health.source || 'bridge-daemon'})`;

      if (stateRes && stateRes.ok) {
        const bridgeState = await stateRes.json();
        const graphCount = Array.isArray(bridgeState?.graphs) ? bridgeState.graphs.length : 0;
        const pending = Array.isArray(bridgeState?.pendingActions) ? bridgeState.pendingActions.length : 0;
        summary += ` • Graphs mirrored: ${graphCount}${pending ? ` • Pending actions: ${pending}` : ''}`;
      }

      await mcpClient.connect();
      setIsConnected(true);
      addMessage('system', `${summary}\nConnection refreshed.`);
    } catch (e) {
      console.error('[AI Collaboration] Bridge refresh failed:', e);
      setIsConnected(false);
      addMessage('system', `Bridge refresh failed: ${e.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSendMessage = async () => {
    if (!currentInput.trim() || isProcessing) return;
    const userMessage = currentInput.trim();

    // Handle slash commands
    if (userMessage.startsWith('/')) {
      const command = userMessage.slice(1).split(' ')[0].toLowerCase();
      const args = userMessage.slice(1).split(' ').slice(1);

      if (command === 'test') {
        addMessage('user', userMessage);
        setCurrentInput('');
        setIsProcessing(true);

        try {
          // Determine test mode from args
          const mode = args.includes('--auto-discover') ? 'auto' :
                      args.includes('--dry-run') ? 'dry' :
                      'full';

          const modeDesc = mode === 'auto' ? 'Auto-discovery mode (testing all 12 tools)' :
                          mode === 'dry' ? 'Dry-run mode (connectivity check only)' :
                          'Full test mode (intent detection tests)';

          addMessage('system', `🧪 Running wizard tests in ${modeDesc}...`);

          // Get API key to pass to test process
          const apiKey = await apiKeyManager.getAPIKey();
          if (!apiKey && mode !== 'dry') {
            addMessage('system', '⚠️ No API key configured. Running in dry-run mode (connectivity check only).');
          }

          // Trigger tests via bridge
          const response = await bridgeFetch('/api/bridge/run-tests', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(apiKey && { 'Authorization': `Bearer ${apiKey}` })
            },
            body: JSON.stringify({ mode })
          });

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }

          const result = await response.json();

          if (result.success) {
            addMessage('system', '✅ Tests started successfully!');
            addMessage('system', 'Watch this chat for results, or check your terminal for detailed output.');
          } else {
            addMessage('system', `⚠️ Tests started but returned: ${result.message || 'Unknown status'}`);
          }

        } catch (error) {
          addMessage('system', `❌ Failed to run tests: ${error.message}`);
          addMessage('system', 'Make sure the bridge daemon is running (npm run bridge)');
        } finally {
          setIsProcessing(false);
        }
        return;
      }

      // Unknown command
      addMessage('user', userMessage);
      addMessage('system', `Unknown command: /${command}\n\nAvailable commands:\n  /test [--dry-run|--auto-discover] - Run wizard tests`);
      setCurrentInput('');
      return;
    }

    addMessage('user', userMessage);
    setCurrentInput('');
    setIsProcessing(true);
    try {
      if (!hasAPIKey) {
        addMessage('system', 'No API key configured. Please set up your OpenRouter or Anthropic API key below to use the Wizard.');
        setShowAPIKeySetup(true);
        setIsProcessing(false);
        return;
      }
      if (!mcpClient.isConnected) { await initializeConnection(); if (!mcpClient.isConnected) { setIsProcessing(false); return; } }
      if (isAutonomousMode) { await handleAutonomousAgent(userMessage); } else { await handleQuestion(userMessage); }
    } catch (error) {
      console.error('[AI Collaboration] Error processing message:', error);
      addMessage('system', `Error: ${error.message}`);
    } finally { setIsProcessing(false); setCurrentAgentRequest(null); }
  };

  const handleStopAgent = () => {
    if (currentAgentRequest) {
      currentAgentRequest.abort();
      setCurrentAgentRequest(null);
      setIsProcessing(false);
      addMessage('system', '🛑 Agent execution stopped by user.');
    }
  };

  const getGraphInfo = () => {
    if (!activeGraphId || !graphsMap || typeof graphsMap.has !== 'function' || !graphsMap.has(activeGraphId)) {
      return { name: 'No active graph', nodeCount: 0, edgeCount: 0 };
    }
    const graph = graphsMap.get(activeGraphId);
    if (!graph) {
      return { name: 'No active graph', nodeCount: 0, edgeCount: 0 };
    }
    const nodeCount = graph.instances && typeof graph.instances.size === 'number' ? graph.instances.size : (graph.instances ? Object.keys(graph.instances).length : 0);
    const edgeCount = Array.isArray(graph.edgeIds) ? graph.edgeIds.length : 0;
    return {
      name: graph.name || 'Unnamed graph',
      nodeCount,
      edgeCount
    };
  };
  const graphInfo = getGraphInfo();
  const graphCount = graphsMap && typeof graphsMap.size === 'number' ? graphsMap.size : 0;

  const handleAutonomousAgent = async (question) => {
    // Message ID for streaming updates - message will be created on first SSE event
    // Defined outside try/catch so it's available in error handler
    const streamingMessageId = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    try {
      const apiConfig = await apiKeyManager.getAPIKeyInfo();
      const apiKey = await apiKeyManager.getAPIKey();
      if (!apiKey) {
        addMessage('system', 'No API key configured. Please set up your OpenRouter or Anthropic API key below to use the Wizard.');
        setShowAPIKeySetup(true);
        return;
      }
      if (!apiConfig) {
        addMessage('system', 'API configuration not found. Please set up your API key below.');
        setShowAPIKeySetup(true);
        return;
      }
      const abortController = new AbortController();
      setCurrentAgentRequest(abortController);
      
      // Send recent conversation history for context memory
      const recentMessages = messages.slice(-10).map(msg => ({
        role: msg.sender === 'user' ? 'user' : msg.sender === 'ai' ? 'assistant' : 'system',
        content: msg.content
      }));

      // Build rich context with actual graph data (not just ID)
      const activeGraphData = activeGraphId && graphsMap && graphsMap.has(activeGraphId)
        ? graphsMap.get(activeGraphId)
        : null;

      // Extract nodes and edges for LLM context (token-limited to top 50 nodes)
      let graphStructure = null;
      if (activeGraphData) {
        const instances = activeGraphData.instances instanceof Map
          ? Array.from(activeGraphData.instances.values())
          : Array.isArray(activeGraphData.instances)
            ? activeGraphData.instances
            : Object.values(activeGraphData.instances || {});

        // Extract nodes and edges for LLM context
        // Adaptive token limit: Use a character budget instead of hard 50-node limit
        const CHAR_BUDGET = 15000; // Approx 3k-4k tokens
        let currentChars = 0;
        const nodeNames = [];
        let truncated = false;

        for (const inst of instances) {
          const name = inst.name || `Node ${inst.id?.slice(-4) || ''}`;
          if (currentChars + name.length > CHAR_BUDGET) {
            truncated = true;
            break;
          }
          nodeNames.push(name);
          currentChars += name.length + 2; // +2 for separator overhead
        }

        const edgeCount = Array.isArray(activeGraphData.edgeIds) ? activeGraphData.edgeIds.length : 0;

        graphStructure = {
          id: activeGraphId,
          name: activeGraphData.name || 'Unnamed',
          nodeCount: instances.length,
          edgeCount,
          nodes: nodeNames,
          truncated
        };
      }

      // Build graph state for new Wizard endpoint
      const graphState = {
        graphs: activeGraphId && graphsMap ? Array.from(graphsMap.values()).map(g => ({
          id: g.id,
          name: g.name,
          instances: g.instances,
          edgeIds: g.edgeIds || []
        })) : [],
        nodePrototypes: activeGraphData ? (() => {
          const instances = activeGraphData.instances instanceof Map
            ? Array.from(activeGraphData.instances.values())
            : Array.isArray(activeGraphData.instances)
              ? activeGraphData.instances
              : Object.values(activeGraphData.instances || {});
          const protoMap = new Map();
          instances.forEach(inst => {
            if (inst.prototypeId && !protoMap.has(inst.prototypeId)) {
              protoMap.set(inst.prototypeId, {
                id: inst.prototypeId,
                name: inst.name,
                color: inst.color,
                description: inst.description
              });
            }
          });
          return Array.from(protoMap.values());
        })() : [],
        edges: [],
        activeGraphId: activeGraphId || null
      };

      console.log('[Wizard] Starting request to /api/wizard', { apiKey: apiKey ? 'present' : 'missing', apiConfig });

      // Use new Wizard endpoint with SSE streaming
      const response = await bridgeFetch('/api/wizard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          message: question,
          graphState,
          config: {
            cid: `wizard-${Date.now()}`,
            apiConfig: apiConfig ? {
              provider: apiConfig.provider,
              endpoint: apiConfig.endpoint,
              model: apiConfig.model,
              settings: apiConfig.settings
            } : null
          }
        }),
        signal: abortController.signal
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Wizard request failed (${response.status}): ${errorBody}`);
      }

      // Process SSE stream
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      // Track processed event IDs to prevent duplicates (React StrictMode safety)
      const processedEvents = new Set();
      let eventCounter = 0;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              try {
                const event = JSON.parse(data);
                
                // Generate unique event ID for deduplication
                const eventId = `${event.type}-${event.id || eventCounter++}-${event.content?.length || 0}`;
                if (processedEvents.has(eventId)) continue;
                processedEvents.add(eventId);
                
                // Update streaming message based on event type
                setMessages(prev => {
                  const updated = [...prev];
                  // Find THIS streaming message by ID, not just any AI message
                  let idx = updated.findIndex(m => m.id === streamingMessageId);
                  if (idx < 0) {
                    // Create new AI message for this stream
                    updated.push({
                      id: streamingMessageId,
                      sender: 'ai',
                      content: '',
                      timestamp: new Date().toISOString(),
                      toolCalls: [],
                      isStreaming: true
                    });
                    idx = updated.length - 1;
                  }

                  const msg = { ...updated[idx] };

                  if (event.type === 'tool_call') {
                    // Add or update tool call
                    const toolCalls = Array.isArray(msg.toolCalls) ? [...msg.toolCalls] : [];
                    const existingIndex = toolCalls.findIndex(tc => tc.id === event.id);
                    if (existingIndex >= 0) {
                      toolCalls[existingIndex] = {
                        ...toolCalls[existingIndex],
                        name: event.name,
                        args: event.args,
                        status: 'running'
                      };
                    } else {
                      toolCalls.push({
                        id: event.id,
                        name: event.name,
                        args: event.args,
                        status: 'running',
                        expanded: false
                      });
                    }
                    msg.toolCalls = toolCalls;
                  } else if (event.type === 'tool_result') {
                    // Update tool call with result
                    const toolCalls = Array.isArray(msg.toolCalls) ? [...msg.toolCalls] : [];
                    const toolIndex = toolCalls.findIndex(tc => tc.id === event.id);
                    if (toolIndex >= 0) {
                      toolCalls[toolIndex] = {
                        ...toolCalls[toolIndex],
                        status: event.result?.error ? 'failed' : 'completed',
                        result: event.result,
                        error: event.result?.error
                      };
                    }
                    msg.toolCalls = toolCalls;
                  } else if (event.type === 'response') {
                    // Stream response text - accumulate from existing state, not external variable
                    msg.content = (msg.content || '') + (event.content || '');
                  } else if (event.type === 'error') {
                    msg.content = `Error: ${event.message}`;
                    msg.isStreaming = false;
                  } else if (event.type === 'done') {
                    msg.isStreaming = false;
                    msg.iterations = event.iterations;
                  }

                  updated[idx] = msg;
                  return updated;
                });
              } catch (e) {
                console.warn('[Wizard] Failed to parse SSE event:', e, data);
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
      setIsConnected(true);
    } catch (error) {
      if (error.name !== 'AbortError') {
        console.error('[AI Collaboration] Autonomous agent failed:', error);
        // Update or create streaming message with error
        setMessages(prev => {
          const updated = [...prev];
          const idx = updated.findIndex(m => m.id === streamingMessageId);
          if (idx >= 0) {
            updated[idx] = { ...updated[idx], content: `Error: ${error.message}`, isStreaming: false };
            return updated;
          }
          // If no streaming message yet, create one with the error
          return [...prev, { id: streamingMessageId, sender: 'ai', content: `Error: ${error.message}`, timestamp: new Date().toISOString(), toolCalls: [], isStreaming: false }];
        });
      }
    } finally {
      setCurrentAgentRequest(null);
    }
  };

  const handleQuestion = async (question) => {
    try {
      const apiConfig = await apiKeyManager.getAPIKeyInfo();
      if (!apiConfig) { addMessage('ai', 'Please set up your API key first by clicking the key icon in the header.'); return; }
      const apiKey = await apiKeyManager.getAPIKey();
      if (!apiKey) { addMessage('ai', 'No API key found. Please set one via the key icon.'); return; }
      const response = await bridgeFetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          message: question,
          systemPrompt: 'You are a concise Redstring copilot. Reference the active graph when possible and keep answers grounded.',
          context: {
            activeGraphId: activeGraphId || null,
            graphInfo,
            graphCount,
            apiConfig: apiConfig ? { provider: apiConfig.provider, endpoint: apiConfig.endpoint, model: apiConfig.model, settings: apiConfig.settings } : null
          },
          model: apiConfig?.model || undefined
        })
      });
      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Chat request failed (${response.status}): ${errorBody}`);
      }
      const data = await response.json();
      addMessage('ai', data.response || 'No response received from the model.');
      setIsConnected(true);
    } catch (error) {
      console.error('[AI Collaboration] Question handling failed:', error);
      addMessage('ai', error.message?.includes('API key') ? error.message : 'I encountered an error while processing your question. Please try again or check your bridge connection.');
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); }
  };

  const toggleClearance = HEADER_HEIGHT + 14;
  const [fileStatus, setFileStatus] = React.useState(null);
  React.useEffect(() => {
    let mounted = true;
    const fetchFileStatus = async () => {
      try {
        const mod = fileStorage;
        if (typeof mod.getFileStatus === 'function') {
          const status = mod.getFileStatus();
          if (mounted) setFileStatus(status);
        }
      } catch { }
    };
    fetchFileStatus();
    const t = setInterval(fetchFileStatus, 3000);
    return () => { mounted = false; clearInterval(t); };
  }, []);

  const handleCopyConversation = () => {
    const conversationText = messages.map(msg => {
      const sender = msg.sender === 'user' ? 'User' : msg.sender === 'ai' ? 'AI' : 'System';
      let text = `${sender}: ${msg.content}`;

      // Add metadata if present (tool calls, mode, etc.)
      if (msg.metadata) {
        const meta = [];
        if (msg.metadata.toolCalls && Array.isArray(msg.metadata.toolCalls) && msg.metadata.toolCalls.length > 0) {
          meta.push('\n  Tool Calls:');
          msg.metadata.toolCalls.forEach((tc, idx) => {
            meta.push(`\n    ${idx + 1}. ${tc.name || 'unknown'} (${tc.status || 'unknown'})`);
            if (tc.args) {
              meta.push(`\n       Args: ${JSON.stringify(tc.args, null, 2).replace(/\n/g, '\n       ')}`);
            }
          });
        }
        if (msg.metadata.mode) {
          meta.push(`\n  Mode: ${msg.metadata.mode}`);
        }
        if (msg.metadata.iterations) {
          meta.push(`\n  Iterations: ${msg.metadata.iterations}`);
        }
        if (msg.metadata.isComplete !== undefined) {
          meta.push(`\n  Complete: ${msg.metadata.isComplete}`);
        }
        text += meta.join('');
      }

      return text;
    }).join('\n\n');

    navigator.clipboard.writeText(conversationText).then(() => {
      addMessage('system', '📋 Conversation copied to clipboard');
    }).catch(err => {
      console.error('Failed to copy:', err);
      addMessage('system', '❌ Failed to copy conversation');
    });
  };

  const handleClearConversation = () => {
    if (messages.length === 0) return;
    if (window.confirm('Clear entire conversation? This cannot be undone.')) {
      setMessages([]);
      try {
        const ts = Date.now();
        localStorage.setItem(RESET_TS_KEY, String(ts));
        localStorage.removeItem(STORAGE_KEY);
      } catch { }
      // Conversation cleared silently (no message)
    }
  };

  const headerActionsEl = (
    <div className="ai-header-actions">
      <button
        className={`ai-flat-button ${showAPIKeySetup ? 'active' : ''}`}
        onClick={() => setShowAPIKeySetup(!showAPIKeySetup)}
        title={hasAPIKey ? 'Manage API Key' : 'Setup API Key'}
      >
        <Key size={20} />
      </button>
      <button
        className="ai-flat-button"
        onClick={() => setShowAdvanced(!showAdvanced)}
        title="Advanced Options"
      >
        <Settings size={20} />
      </button>
      <button
        className="ai-flat-button"
        onClick={handleCopyConversation}
        title="Copy conversation to clipboard"
        disabled={messages.length === 0}
      >
        <Copy size={20} />
      </button>
      <button
        className="ai-flat-button"
        onClick={handleClearConversation}
        title="Clear conversation"
        disabled={messages.length === 0}
      >
        <Trash2 size={20} />
      </button>
      <button
        className={`ai-flat-button ${isConnected ? 'ai-refresh-button' : 'ai-connect-button'}`}
        onClick={refreshBridgeConnection}
        title={isConnected ? 'Bridge connected' : 'Reconnect bridge daemon'}
        disabled={isProcessing}
      >
        <RotateCcw size={20} />
      </button>
      <button
        className={`ai-flat-button ${showDruidMind ? 'active' : ''}`}
        onClick={() => {
          if (!druidInstance) {
            setDruidInstance(new DruidInstance());
          }
          setShowDruidMind(!showDruidMind);
        }}
        title="View The Druid's Mind"
      >
        <Brain size={20} />
      </button>
    </div>
  );

  return (
    <div className="ai-collaboration-panel">
      <div className="ai-panel-header">
        {!compact ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gridColumn: '1 / -1' }}>
            <div className="ai-mode-dropdown">
              <div className="ai-status-indicator-wrapper">
                <div className={`ai-status-indicator ${isConnected ? 'connected' : 'disconnected'}`} />
              </div>
              <select className="ai-mode-select" value={isAutonomousMode ? 'wizard' : 'chat'} onChange={(e) => setIsAutonomousMode(e.target.value === 'wizard')} aria-label="Mode">
                <option value="wizard">Wizard</option>
                <option value="chat">Chat</option>
              </select>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              {headerActionsEl}
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', width: '100%', gridColumn: '1 / -1' }}>
            <div className="ai-mode-dropdown">
              <div className="ai-status-indicator-wrapper">
                <div className={`ai-status-indicator ${isConnected ? 'connected' : 'disconnected'}`} />
              </div>
              <select className="ai-mode-select" value={isAutonomousMode ? 'wizard' : 'chat'} onChange={(e) => setIsAutonomousMode(e.target.value === 'wizard')} aria-label="Mode">
                <option value="wizard">Wizard</option>
                <option value="chat">Chat</option>
              </select>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-start', marginTop: 8, paddingLeft: 6 }}>
              {headerActionsEl}
            </div>
          </div>
        )}
      </div>

      {/* Dedicated graph info section below the header so layout is consistent across widths */}
      <div className="ai-graph-info-section" style={{ padding: '12px 0 12px 0' }}>
        <div className="ai-graph-info-left" style={{ paddingLeft: '6px' }}>
          <span className="ai-graph-name">{graphInfo.name}</span>
          <span className="ai-graph-stats">{graphInfo.nodeCount} nodes • {graphInfo.edgeCount} edges</span>
        </div>
      </div>
      {/* Dividing line below graph info section */}
      <StandardDivider margin="0" />

      {showAPIKeySetup && (
        <div className="ai-api-setup-section">
          <APIKeySetup onKeySet={() => checkAPIKey()} onClose={() => setShowAPIKeySetup(false)} inline={true} />
        </div>
      )}

      {showDruidMind && druidInstance && (
        <div className="ai-druid-mind-section" style={{ borderTop: '1px solid #e0e0e0', borderBottom: '1px solid #e0e0e0', maxHeight: '400px', overflowY: 'auto' }}>
          <DruidMindPanel druidInstance={druidInstance} />
        </div>
      )}

      <div className="ai-panel-content">
        <div className="ai-chat-mode">
          <div className="ai-messages" style={{ display: 'flex', flexDirection: 'column', height: '100%', justifyContent: messages.length === 0 ? 'center' : 'flex-start' }}>
            {isConnected && messages.length === 0 && (
              <div style={{ textAlign: 'center', color: '#555', fontFamily: "'EmOne', sans-serif", fontSize: '14px' }}>What will we build today?</div>
            )}
            {messages.map((message) => (
              <div key={message.id} className={`ai-message ai-message-${message.sender}`} style={{ alignSelf: message.sender === 'user' ? 'flex-end' : 'flex-start', maxWidth: '85%' }}>
                <div className="ai-message-avatar">
                  {message.sender === 'user' ? <User size={16} /> : message.sender === 'system' ? null : <Bot size={16} />}
                </div>
                <div className="ai-message-content">
                  {message.toolCalls && message.toolCalls.length > 0 && (
                    <div className="ai-tool-calls">
                      {message.toolCalls.map((toolCall, index) => (
                        <ToolCallCard
                          key={index}
                          toolName={toolCall.name}
                          status={toolCall.status || 'running'}
                          args={toolCall.args}
                          result={toolCall.result}
                          error={toolCall.error}
                          timestamp={toolCall.timestamp}
                          executionTime={toolCall.executionTime}
                        />
                      ))}
                    </div>
                  )}
                  {/* Only render text box if there's content */}
                  {message.content && (
                    <div
                      className="ai-message-text"
                      style={{ userSelect: 'text', cursor: 'text' }}
                      dangerouslySetInnerHTML={message.sender === 'system' ? { __html: renderMarkdown(message.content) } : undefined}
                    >
                      {message.sender !== 'system' ? message.content : null}
                    </div>
                  )}
                  <div className="ai-message-timestamp">{new Date(message.timestamp).toLocaleTimeString()}</div>
                </div>
              </div>
            ))}
            {isProcessing && (() => {
              // Find the streaming message to check if it has content
              const streamingMsg = messages.find(m => m.isStreaming);
              const hasStreamingContent = streamingMsg && (streamingMsg.content || (streamingMsg.toolCalls && streamingMsg.toolCalls.length > 0));
              
              // Only show thinking dots if no streaming content yet
              if (!hasStreamingContent) {
                return (
                  <div className="ai-thinking-row">
                    <div className="ai-message-avatar"><Bot size={16} /></div>
                    <span className="ai-thinking-dots">
                      <span>•</span>
                      <span>•</span>
                      <span>•</span>
                    </span>
                  </div>
                );
              }
              return null;
            })()}
            <div ref={messagesEndRef} />
          </div>
          <div className="ai-input-container" style={{ marginBottom: toggleClearance }}>
            <textarea ref={inputRef} value={currentInput} onChange={(e) => setCurrentInput(e.target.value)} onKeyPress={handleKeyPress} placeholder={isAutonomousMode ? "Write your vision and I'll cast my spells..." : "Ask me anything about your knowledge graph..."} disabled={isProcessing} className="ai-input" rows={2} />
            {isProcessing && currentAgentRequest ? (
              <button onClick={handleStopAgent} className="ai-stop-button" title="Stop Agent"><Square size={16} /></button>
            ) : (
              <button onClick={handleSendMessage} disabled={!currentInput.trim() || isProcessing} className="ai-send-button"><Send size={24} /></button>
            )}
          </div>
        </div>
      </div>

    </div>
  );
};

export default LeftAIView;
