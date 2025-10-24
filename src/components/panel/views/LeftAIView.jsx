import React from 'react';
import { Bot, Key, Settings, RotateCcw, Send, User } from 'lucide-react';
import APIKeySetup from '../../../ai/components/APIKeySetup.jsx';
import mcpClient from '../../../services/mcpClient.js';
import apiKeyManager from '../../../services/apiKeyManager.js';

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
    } catch {}
    let resetTs = 0;
    try {
      const cached = localStorage.getItem(STORAGE_KEY);
      const rt = localStorage.getItem(RESET_TS_KEY);
      resetTs = rt ? Number(rt) || 0 : 0;
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed)) setMessages(parsed);
      }
    } catch {}
    (async () => {
      try {
        if (messages.length > 0) return;
        // Bridge telemetry disabled
        // const res = await bridgeFetch('/api/bridge/telemetry');
        // if (res.ok) {
        //   const data = await res.json();
        //   const chat = Array.isArray(data?.chat) ? data.chat : [];
        //   if (chat.length > 0) {
        //     const hydrated = chat
        //       .filter((c) => !resetTs || (typeof c.ts === 'number' && c.ts >= resetTs))
        //       .map((c) => ({
        //         id: `${c.ts || Date.now()}_${Math.random().toString(36).slice(2,9)}`,
        //         sender: c.role === 'user' ? 'user' : (c.role === 'ai' : 'ai' : 'system'),
        //         content: c.text || '',
        //         timestamp: new Date(c.ts || Date.now()).toISOString(),
        //         metadata: {}
        //       }));
        //     setMessages((prev) => (prev.length === 0 ? hydrated : prev));
        //   }
        // }
      } catch {}
    })();
  }, []);

  React.useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(messages)); } catch {}
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
    const message = {
      id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      sender,
      content,
      timestamp: new Date().toISOString(),
      metadata,
      toolCalls: (metadata.toolCalls || []).map(tc => ({ ...tc, expanded: false }))
    };
    setMessages(prev => [...prev, message]);
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
        if (t.type === 'tool_call') {
          const status = t.status || (t.leased ? 'running' : 'running');
          upsertToolCall({ id: t.id, name: t.name || 'tool', status, args: t.args, cid: t.cid });
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
              updated[idx] = { ...updated[idx], content: finalText };
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
      addMessage('system', 'Bridge functionality is currently disabled.');
    } catch (e) {
      addMessage('system', `Refresh failed: ${e.message}`);
    } finally { setIsProcessing(false); }
  };

  const handleSendMessage = async () => {
    if (!currentInput.trim() || isProcessing) return;
    const userMessage = currentInput.trim();
    addMessage('user', userMessage);
    setCurrentInput('');
    setIsProcessing(true);
    try {
      if (!hasAPIKey) { addMessage('ai', 'Please set up your API key first by clicking the key icon (🔑) in the header.'); setIsProcessing(false); return; }
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

  const handleAutonomousAgent = async (question) => {
    try {
      const apiConfig = await apiKeyManager.getAPIKeyInfo();
      const apiKey = await apiKeyManager.getAPIKey();
      if (!apiKey) { addMessage('ai', 'No API key found. Please set up your API key first.'); return; }
      if (!apiConfig) { addMessage('ai', 'API configuration not found. Please set up your API key first.'); return; }
      const abortController = new AbortController();
      setCurrentAgentRequest(abortController);
      // Bridge agent API disabled
      // const response = await bridgeFetch('/api/ai/agent', {
      //   method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      //   body: JSON.stringify({ message: question, systemPrompt: 'You are an AI assistant with access to Redstring knowledge graph tools.', context: { activeGraphId, graphCount: graphs.size, hasAPIKey, apiConfig: apiConfig ? { provider: apiConfig.provider, endpoint: apiConfig.endpoint, model: apiConfig.model, settings: apiConfig.settings } : null } }),
      //   signal: abortController.signal
      // });
      // if (!response.ok) throw new Error(`Agent request failed: ${response.status} ${response.statusText}`);
      // const result = await response.json();
      // addMessage('ai', result.response || '', { toolCalls: result.toolCalls || [], iterations: result.iterations, mode: 'autonomous', isComplete: result.isComplete });
      addMessage('ai', 'Autonomous agent mode is currently disabled due to bridge server being unavailable.');
    } catch (error) {
      if (error.name !== 'AbortError') { console.error('[AI Collaboration] Autonomous agent failed:', error); addMessage('ai', `Agent error: ${error.message}`); }
    }
  };

  const handleQuestion = async (question) => {
    try {
      const apiConfig = await apiKeyManager.getAPIKeyInfo();
      if (!apiConfig) { addMessage('ai', 'Please set up your API key first by clicking the key icon in the header.'); return; }
      const apiKey = await apiKeyManager.getAPIKey();
      // Bridge chat API disabled
      addMessage('ai', 'Chat functionality is currently disabled due to bridge server being unavailable.');
    } catch (error) {
      console.error('[AI Collaboration] Question handling failed:', error);
      addMessage('ai', 'I encountered an error while processing your question. Please try again or check your connection to the MCP server.');
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); }
  };

  const getGraphInfo = () => {
    if (!activeGraphId || !graphsMap.has(activeGraphId)) { return { name: 'No active graph', nodeCount: 0, edgeCount: 0 }; }
    const graph = graphsMap.get(activeGraphId);
    return { name: graph.name, nodeCount: graph.instances.size, edgeCount: graph.edgeIds.length };
  };
  const graphInfo = getGraphInfo();
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
      } catch {}
    };
    fetchFileStatus();
    const t = setInterval(fetchFileStatus, 3000);
    return () => { mounted = false; clearInterval(t); };
  }, []);

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
        className={`ai-flat-button ${isConnected ? 'ai-refresh-button' : 'ai-connect-button'}`} 
        onClick={refreshBridgeConnection} 
        title="Bridge Disabled" 
        disabled={isProcessing}
      >
        <RotateCcw size={20} />
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

      <div className="ai-panel-content">
        <div className="ai-chat-mode">
          <div className="ai-messages" style={{ display: 'flex', flexDirection: 'column', height: '100%', justifyContent: messages.length === 0 ? 'center' : 'flex-start' }}>
            {isConnected && messages.length === 0 && (
              <div style={{ textAlign: 'center', color: '#555', fontFamily: "'EmOne', sans-serif", fontSize: '14px' }}>What will we build today?</div>
            )}
            {messages.map((message) => (
              <div key={message.id} className={`ai-message ai-message-${message.sender}`} style={{ alignSelf: message.sender === 'user' ? 'flex-end' : 'flex-start', maxWidth: '85%' }}>
                <div className="ai-message-avatar">{message.sender === 'user' ? <User size={16} /> : <Bot size={16} />}</div>
                <div className="ai-message-content">
                  {message.toolCalls && message.toolCalls.length > 0 && (
                    <div className="ai-tool-calls">
                      {message.toolCalls.map((toolCall, index) => (
                        <div key={index} className={`ai-tool-call ai-tool-call-${toolCall.status || 'running'}`}>
                          <div className="ai-tool-call-header" style={{ cursor: 'pointer' }} onClick={() => {
                            setMessages(prev => prev.map(m => {
                              if (m.id !== message.id) return m;
                              const copy = { ...m };
                              copy.toolCalls = copy.toolCalls.map((c, ci) => ci === index ? { ...c, expanded: !c.expanded } : c);
                              return copy;
                            }));
                          }}>
                            <div className="ai-tool-call-icon" aria-hidden>
                              {toolCall.status === 'completed' ? <Square style={{ transform: 'rotate(45deg)' }} size={12} /> : toolCall.status === 'failed' ? <Square size={12} /> : <RotateCcw size={12} />}
                            </div>
                            <span className="ai-tool-call-name">{toolCall.name}</span>
                            <span className="ai-tool-call-status">{toolCall.status === 'completed' ? 'Completed' : toolCall.status === 'failed' ? 'Failed' : 'Running...'}</span>
                          </div>
                          {toolCall.args && toolCall.expanded && (<div className="ai-tool-call-args"><small>{JSON.stringify(toolCall.args, null, 2)}</small></div>)}
                          {toolCall.result && toolCall.expanded && (<div className="ai-tool-call-result"><div className="ai-tool-call-result-content">{toolCall.result}</div></div>)}
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="ai-message-text" style={{ userSelect: 'text', cursor: 'text' }}>{message.content}</div>
                  <div className="ai-message-timestamp">{new Date(message.timestamp).toLocaleTimeString()}</div>
                </div>
              </div>
            ))}
            {isProcessing && (
              <div className="ai-message ai-message-ai" style={{ alignSelf: 'flex-start' }}>
                <div className="ai-message-avatar"><Bot size={16} /></div>
                <div className="ai-message-content">
                  <div className="ai-message-text">
                    <div className="ai-typing-spinner" aria-label="AI is thinking" />
                    <div className="ai-processing-status">{isAutonomousMode ? 'Agent thinking and using tools...' : 'Thinking...'}</div>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
          <div className="ai-input-container" style={{ marginBottom: toggleClearance }}>
            <textarea ref={inputRef} value={currentInput} onChange={(e) => setCurrentInput(e.target.value)} onKeyPress={handleKeyPress} placeholder={isAutonomousMode ? "Tell me what you want to accomplish (I'll use multiple tools to complete it)..." : "Ask me anything about your knowledge graph..."} disabled={isProcessing} className="ai-input" rows={2} />
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
