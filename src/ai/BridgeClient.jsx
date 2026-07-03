import { useEffect, useRef } from 'react';
import useGraphStore from '../store/graphStore.js';
import { bridgeEventSource, bridgeFetch } from '../services/bridgeConfig.js';
import { navigateOnGraphSwitch } from '../services/canvasNavigationService.js';
import {
  buildBridgeState,
  buildGraphLayouts,
  buildGraphSummaries
} from '../services/bridgeStateSerializer.js';
import { createStoreActions, normalizeId, priority } from '../services/storeActions.js';
import { createDaemonCoexistence } from '../services/daemonCoexistence.js';
import saveCoordinator from '../services/SaveCoordinator.js';
import { exportToRedstring } from '../formats/redstringFormat.js';

/**
 * Bridge Client Component (formerly MCPBridge)
 *
 * Establishes a bridge between the Redstring store and the orchestration daemon.
 * Sends minimal store state via HTTP and registers store actions for applyMutations.
 */
const BridgeClient = () => {
  const intervalRef = useRef(null);
  const mountedRef = useRef(false);
  // Separate interval refs to avoid accidental overlap/mismanagement
  const dataIntervalRef = useRef(null);
  const bridgeIntervalRef = useRef(null);
  const reconnectIntervalRef = useRef(null);
  const eventSourceRef = useRef(null);
  const connectionStateRef = useRef({
    isConnected: false,
    lastSuccessfulConnection: null,
    reconnectAttempts: 0,
    maxReconnectAttempts: 3
  });
  // Track last telemetry timestamp sent to UI to avoid spam
  const lastTelemetryTsRef = useRef(0);
  // Track last user activity to throttle polling when idle
  // Initialized to now so we start in fast mode
  const lastActivityRef = useRef(Date.now());

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  /**
   * Check if the bridge server is responding
   */
  const checkBridgeHealth = async () => {
    try {
      const response = await bridgeFetch('/api/bridge/telemetry', {
        method: 'GET',
        // Small timeout to fail fast
        signal: AbortSignal.timeout(2000)
      });
      return response.ok;
    } catch (e) {
      return false;
    }
  };

  // Function to handle connection recovery
  const handleConnectionRecovery = async () => {
    const connectionState = connectionStateRef.current;

    console.log(`🔄 MCP Bridge: Attempting reconnection (attempt ${connectionState.reconnectAttempts + 1}/${connectionState.maxReconnectAttempts})`);

    const isHealthy = await checkBridgeHealth();

    if (isHealthy) {
      console.log('✅ MCP Bridge: Server is healthy, re-establishing connection...');

      // Reset connection state
      connectionState.isConnected = true;
      connectionState.lastSuccessfulConnection = Date.now();
      connectionState.reconnectAttempts = 0;

      // Clear reconnection interval
      if (reconnectIntervalRef.current) {
        clearInterval(reconnectIntervalRef.current);
        reconnectIntervalRef.current = null;
      }

      // Re-register actions and restart polling
      try {
        // Trigger re-registration via event
        window.dispatchEvent(new CustomEvent('rs-bridge-reconnect'));
        console.log('🎉 MCP Bridge: Reconnection signal sent!');
      } catch (error) {
        console.error('❌ MCP Bridge: Failed to send reconnection signal:', error);
        connectionState.isConnected = false;
      }
    } else {
      connectionState.reconnectAttempts++;

      if (connectionState.reconnectAttempts >= connectionState.maxReconnectAttempts) {
        console.log('🔌 MCP Bridge: Max reconnection attempts reached - this is normal if the bridge connector isn\'t running');
        if (reconnectIntervalRef.current) {
          clearInterval(reconnectIntervalRef.current);
          reconnectIntervalRef.current = null;
        }
      } else {
        const nextAttemptDelay = Math.min(1000 * Math.pow(2, connectionState.reconnectAttempts), 30000);
        console.log(`⏳ MCP Bridge: Next reconnection attempt in ${nextAttemptDelay / 1000}s - this is normal if the bridge connector isn't running`);
      }
    }
  };

  // Function to start reconnection process
  const startReconnection = () => {
    const connectionState = connectionStateRef.current;

    if (connectionState.isConnected) {
      connectionState.isConnected = false;
      console.log('🔌 MCP Bridge: Connection lost, starting reconnection process... - this is normal if the bridge connector isn\'t running');
    }

    // Stop normal polling
    if (dataIntervalRef.current) {
      clearInterval(dataIntervalRef.current);
      dataIntervalRef.current = null;
    }
    // Tear down SSE while disconnected to avoid network spam
    try {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    } catch { }

    // Start reconnection attempts if not already running
    if (!reconnectIntervalRef.current) {
      connectionState.reconnectAttempts = 0;
      handleConnectionRecovery(); // Immediate first attempt

      // Set up periodic reconnection attempts with exponential backoff
      reconnectIntervalRef.current = setInterval(() => {
        const currentDelay = Math.min(5000 * Math.pow(2, connectionState.reconnectAttempts), 30000);
        setTimeout(handleConnectionRecovery, currentDelay);
      }, 5000);
    }
  };

  useEffect(() => {

    // Wikipedia enrichment functions removed — all enrichment now handled by
    // LeftAIView.jsx (calls server /api/enrich endpoint, writes to imageCache store)

    // Listen for reconnection signal
    const handleReconnectEvent = () => {
      registerStoreActions();
      sendStoreToServer();

      // Restart normal polling
      if (dataIntervalRef.current) {
        clearInterval(dataIntervalRef.current);
      }
      dataIntervalRef.current = setInterval(sendStoreToServer, 10000);

      // Ensure SSE is established only when connected
      try {
        if (!eventSourceRef.current) {
          const es = bridgeEventSource('/events/stream');
          eventSourceRef.current = es;
          es.addEventListener('PATCH_APPLIED', () => { });
          es.onerror = () => { try { es.close(); } catch { }; eventSourceRef.current = null; };
        }
      } catch { }
    };

    window.addEventListener('rs-bridge-reconnect', handleReconnectEvent);


    // Function to register store actions with the bridge server
    const registerStoreActions = async () => {
      try {
        const state = useGraphStore.getState();
        const layouts = buildGraphLayouts(state);
        const summaries = buildGraphSummaries(state);

        // Create a wrapper for store actions that can be called remotely
        // Create action metadata (not functions, since they can't be serialized)
        const actionMetadata = {
          ensureGraph: {
            description: 'Ensure a graph exists (create if missing) without switching context',
            parameters: ['graphId', 'initialData']
          },
          addNodePrototype: {
            description: 'Add a new node prototype',
            parameters: ['prototypeId', 'prototypeData']
          },
          addNodeInstance: {
            description: 'Add a node instance to a graph',
            parameters: ['graphId', 'prototypeId', 'position', 'instanceId']
          },
          removeNodeInstance: {
            description: 'Remove a node instance from a graph',
            parameters: ['graphId', 'instanceId']
          },
          updateNodePrototype: {
            description: 'Update a node prototype',
            parameters: ['prototypeId', 'updates']
          },
          setActiveGraph: {
            description: 'Set the active graph',
            parameters: ['graphId']
          },
          openGraph: {
            description: 'Open a graph',
            parameters: ['graphId']
          },
          createNewGraph: {
            description: 'Create a new empty graph and set it active',
            parameters: ['initialData']
          },
          createAndAssignGraphDefinition: {
            description: 'Create and activate a new definition graph for a prototype',
            parameters: ['prototypeId']
          },
          openRightPanelNodeTab: {
            description: 'Open a node tab in the right panel',
            parameters: ['nodeId']
          },
          addEdge: {
            description: 'Add an edge to a graph',
            parameters: ['graphId', 'edgeData']
          },
          updateEdgeDirectionality: {
            description: 'Update edge directionality arrowsToward list',
            parameters: ['edgeId', 'arrowsToward']
          },
          applyMutations: {
            description: 'Apply a batch of store mutations in one shot',
            parameters: ['operations']
          },
          addToAbstractionChain: {
            description: 'Add a node to an abstraction chain',
            parameters: ['nodeId', 'dimension', 'direction', 'newNodeId', 'insertRelativeToNodeId']
          },
          removeFromAbstractionChain: {
            description: 'Remove a node from an abstraction chain',
            parameters: ['nodeId', 'dimension', 'nodeToRemove']
          },
          swapNodeInChain: {
            description: 'Swap a node in an abstraction chain',
            parameters: ['currentNodeId', 'newNodeId']
          },
          setNodeType: {
            description: 'Set the type of a node prototype',
            parameters: ['nodeId', 'typeNodeId']
          },
          closeGraphTab: {
            description: 'Close a graph tab',
            parameters: ['graphId']
          },
          chat: {
            description: 'Send a message to the AI model',
            parameters: ['message', 'context']
          },
          sendWizardMessage: {
            description: 'Simulate the user sending a message via the Wizard text input',
            parameters: ['message']
          },
          getWizardTabs: {
            description: 'Get current wizard conversations (tabs)',
            parameters: []
          },
          getWizardStatus: {
            description: 'Get current wizard status (API key configured, is processing, connected)',
            parameters: []
          },
          switchWizardTab: {
            description: 'Switch the active wizard tab',
            parameters: ['conversationId']
          },
          createWizardTab: {
            description: 'Create a new wizard conversation tab',
            parameters: []
          }
        };

        // Store the actual functions in a global variable that the bridge server
        // can access. Handlers live in the shared, environment-agnostic
        // createStoreActions (src/services/storeActions.js) so the Node daemon
        // executes the identical mutations; browser-only concerns are injected.
        if (typeof window !== 'undefined') {
          window.redstringStoreActions = createStoreActions({
            useGraphStore,
            emitEvent: (evt) => window.dispatchEvent(evt),
            markActive: () => { lastActivityRef.current = Date.now(); },
            navigate: navigateOnGraphSwitch,
            // Lazy: sendStoreToServer is defined later in this effect scope.
            syncState: () => sendStoreToServer(),
            bridgeStateFetch: () => bridgeFetch('/api/bridge/state'),
            uiCallbacks: {
              // Resolved at call time so LeftAIView can register these globals
              // after the bridge effect runs.
              get getTabs() { return typeof window.__rs_getTabs === 'function' ? window.__rs_getTabs : undefined; },
              get getWizardStatus() { return typeof window.__rs_getWizardStatus === 'function' ? window.__rs_getWizardStatus : undefined; }
            }
          });
        }

        console.log('MCPBridge: Created action metadata with keys:', Object.keys(actionMetadata));

        // Register action metadata with bridge server
        console.log('MCPBridge: About to register action metadata:', Object.keys(actionMetadata));

        const response = await bridgeFetch('/api/bridge/register-store', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            actions: actionMetadata,
            hasWindowActions: typeof window !== 'undefined' && !!window.redstringStoreActions
          })
        });

        if (response.ok) {
          const result = await response.json();
          console.log('✅ MCP Bridge: Store actions registered with bridge server:', result);
        } else {
          const errorText = await response.text();
          throw new Error(`HTTP ${response.status}: ${errorText}`);
        }
      } catch (error) {
        // Provide more user-friendly error messages
        if (error.message.includes('bridge_unavailable_cooldown')) {
          const cooldownMatch = error.message.match(/(\d+)s remaining/);
          const cooldownSeconds = cooldownMatch ? cooldownMatch[1] : 'unknown';
          console.log(`⏳ MCP Bridge: Bridge temporarily unavailable (${cooldownSeconds}s cooldown) - this is normal if the bridge connector isn't running`);
        } else if (error.message.includes('Failed to fetch')) {
          console.log(`🔌 MCP Bridge: Unable to connect to bridge server - this is normal if the bridge connector isn't running`);
        } else {
          console.error('❌ MCP Bridge: Failed to register store actions:', error);
        }
        connectionStateRef.current.isConnected = false;
        startReconnection();
      }
    };

    // Function to send store state to server
    const sendStoreToServer = async () => {
      try {
        const state = useGraphStore.getState();
        // Include file status for debugging/persistence visibility
        let fileStatus = null;
        try {
          const mod = await import('../store/fileStorage.js');
          if (typeof mod.getFileStatus === 'function') {
            fileStatus = mod.getFileStatus();
          }
        } catch { }

        // Build the bridge-state payload from the shared serializer (same code
        // the Node daemon uses) so the shape stays identical everywhere.
        const bridgeData = buildBridgeState(state, { fileStatus });

        // Send to server
        const response = await bridgeFetch('/api/bridge/state', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(bridgeData)
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
      } catch (error) {
        // Provide more user-friendly error messages
        if (error.message.includes('bridge_unavailable_cooldown')) {
          const cooldownMatch = error.message.match(/(\d+)s remaining/);
          const cooldownSeconds = cooldownMatch ? cooldownMatch[1] : 'unknown';
          console.log(`⏳ MCP Bridge: Bridge temporarily unavailable (${cooldownSeconds}s cooldown) - this is normal if the bridge connector isn't running`);
        } else if (error.message.includes('Failed to fetch')) {
          console.log(`🔌 MCP Bridge: Unable to connect to bridge server - this is normal if the bridge connector isn't running`);
        } else {
          console.error('❌ MCP Bridge: Failed to send store to server:', error);
        }

        const isConnectionError = error.message.includes('fetch') ||
          error.message.includes('ECONNREFUSED') ||
          error.message.includes('Failed to fetch') ||
          error.message.includes('bridge_unavailable_cooldown');
        if (isConnectionError && connectionStateRef.current.isConnected) {
          connectionStateRef.current.isConnected = false;
          startReconnection();
        }
      }
    };

    // Register store actions and send initial state
    const initializeConnection = async () => {
      try {
        await registerStoreActions();
        await sendStoreToServer();

        // Mark as connected on successful initialization
        connectionStateRef.current.isConnected = true;
        connectionStateRef.current.lastSuccessfulConnection = Date.now();

        console.log('✅ MCP Bridge: Redstring store bridge established');
        console.log('✅ MCP Bridge: Store state:', {
          graphs: useGraphStore.getState().graphs.size,
          nodePrototypes: useGraphStore.getState().nodePrototypes.size,
          activeGraphId: useGraphStore.getState().activeGraphId,
          openGraphIds: useGraphStore.getState().openGraphIds.length
        });
        // Establish SSE now that we know server is reachable
        try {
          if (!eventSourceRef.current) {
            const es = bridgeEventSource('/events/stream');
            eventSourceRef.current = es;
            es.addEventListener('PATCH_APPLIED', () => { });
            es.onerror = () => { try { es.close(); } catch { }; eventSourceRef.current = null; };
          }
        } catch { }
      } catch (error) {
        console.error('❌ MCP Bridge: Failed to initialize connection:', error);
        connectionStateRef.current.isConnected = false;
        startReconnection();
      }
    };

    // Expose a manual reconnect hook so the panel Refresh button can restart attempts
    try {
      window.rsBridgeManualReconnect = () => {
        try {
          if (reconnectIntervalRef.current) {
            clearInterval(reconnectIntervalRef.current);
            reconnectIntervalRef.current = null;
          }
        } catch { }
        try {
          const mod = require('../services/bridgeConfig.js');
          if (mod && typeof mod.resetBridgeBackoff === 'function') {
            mod.resetBridgeBackoff();
          }
        } catch { }
        const st = connectionStateRef.current;
        st.reconnectAttempts = 0;
        st.isConnected = false;
        startReconnection();
      };
    } catch { }

    // Attempt immediate connection, then retry a few times quickly if needed
    initializeConnection();
    let quickRetries = 0;
    const quickRetryTimer = setInterval(async () => {
      if (connectionStateRef.current.isConnected) {
        clearInterval(quickRetryTimer);
        return;
      }
      if (quickRetries >= 5) {
        clearInterval(quickRetryTimer);
        return;
      }
      quickRetries++;
      try {
        await registerStoreActions();
        await sendStoreToServer();
        connectionStateRef.current.isConnected = true;
        connectionStateRef.current.lastSuccessfulConnection = Date.now();
        console.log('✅ MCP Bridge: Quick retry connected');
        clearInterval(quickRetryTimer);
      } catch { }
    }, 1000);

    // Set up a polling mechanism to keep the bridge updated
    dataIntervalRef.current = setInterval(sendStoreToServer, 10000); // Update every 10 seconds

    // Set up a listener for save triggers and pending actions from the bridge server
    const checkForBridgeUpdates = async () => {
      try {
        // Skip all bridge polling while disconnected to avoid console spam
        if (!connectionStateRef.current.isConnected) {
          return;
        }
        // Check for save triggers (legacy noop) — disabled to avoid 404 spam

        // Check for bridge state changes and sync them back to Redstring
        // DISABLED: This was causing conflicts with Redstring state restoration
        // TODO: Re-implement this as a one-way sync only when AI tools make explicit changes
        // 
        // const bridgeResponse = await bridgeFetch('/api/bridge/state');
        // if (bridgeResponse.ok) {
        //   const bridgeData = await bridgeResponse.json();
        //   // ... sync logic disabled for now
        // }

        // Check for pending actions
        const actionsResponse = await bridgeFetch('/api/bridge/pending-actions');
        if (actionsResponse.ok) {
          const actionsData = await actionsResponse.json();
          if (actionsData.pendingActions && actionsData.pendingActions.length > 0) {
            // Activity detected! Reset idle timer
            lastActivityRef.current = Date.now();
            console.log('✅ MCP Bridge: Found pending actions:', actionsData.pendingActions.length);
            // Execute actions in a stable dependency-friendly order
            const orderedActions = [...actionsData.pendingActions].sort((a, b) => priority(a) - priority(b));

            for (const pendingAction of orderedActions) {
              try {
                // Emit running status to telemetry so chat shows non-stalled progress
                try {
                  // Inform bridge about start to produce ordered telemetry with seq
                  try {
                    await bridgeFetch('/api/bridge/action-started', {
                      method: 'POST', headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ actionId: pendingAction.id, action: pendingAction.action, params: pendingAction.params })
                    });
                  } catch { }
                  window.dispatchEvent(new CustomEvent('rs-telemetry', { detail: [{ ts: Date.now(), type: 'tool_call', name: pendingAction.action, args: pendingAction.params, status: 'running', id: pendingAction.id }] }));
                } catch { }
                // Also emit a brief chat update before executing
                // DISABLED: This creates duplicate status messages
                // The tool_call telemetry above already shows the status
                /*
                try {
                  const preText = (() => {
                    if (pendingAction.action === 'applyMutations' && Array.isArray(pendingAction.params?.[0])) {
                      const ops = pendingAction.params[0];
                      const createCount = ops.filter(o => o?.type === 'createNewGraph').length;
                      if (createCount > 0) return `Starting: create ${createCount} graph(s).`;
                      return `Starting: apply ${ops.length} change(s).`;
                    }
                    if (pendingAction.action === 'openGraph') return 'Opening graph...';
                    if (pendingAction.action === 'addNodePrototype') return 'Creating a new concept...';
                    return `Starting: ${pendingAction.action}...`;
                  })();
                  window.dispatchEvent(new CustomEvent('rs-telemetry', { detail: [{ ts: Date.now(), type: 'agent_answer', text: preText, cid: pendingAction.meta?.cid, id: pendingAction.id }] }));
                } catch {}
                */
                if (window.redstringStoreActions && window.redstringStoreActions[pendingAction.action]) {
                  console.log('✅ MCP Bridge: Executing action:', pendingAction.action, pendingAction.params);

                  // Special handling: openGraph with missing graph should be deferred
                  if (pendingAction.action === 'openGraph') {
                    try {
                      const gid = normalizeId(Array.isArray(pendingAction.params) ? pendingAction.params[0] : pendingAction.params, 'graphId');
                      const stBefore = useGraphStore.getState();
                      if (!stBefore.graphs.has(gid)) {
                        // Try ensureGraph based on bridge data
                        const bridgeResponse = await bridgeFetch('/api/bridge/state');
                        if (bridgeResponse.ok) {
                          const b = await bridgeResponse.json();
                          const existsInBridge = Array.isArray(b.graphs) && b.graphs.some(g => g.id === gid);
                          if (existsInBridge && window.redstringStoreActions.ensureGraph) {
                            await window.redstringStoreActions.ensureGraph(gid, { name: (b.graphs.find(g => g.id === gid)?.name) || 'New Graph' });
                          }
                        }
                        const stAfter = useGraphStore.getState();
                        if (!stAfter.graphs.has(gid)) {
                          // Re-enqueue with short backoff and skip now
                          try {
                            setTimeout(async () => {
                              await bridgeFetch('/api/bridge/pending-actions/enqueue', {
                                method: 'POST', headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ actions: [{ action: 'openGraph', params: [gid] }] })
                              });
                            }, 400);
                          } catch { }
                          // Mark as completed-noop so chat doesn't hang
                          try { window.dispatchEvent(new CustomEvent('rs-telemetry', { detail: [{ ts: Date.now(), type: 'tool_call', name: 'openGraph', status: 'completed', id: pendingAction.id }] })); } catch { }
                          continue;
                        }
                      }
                    } catch { }
                  }

                  // For addNodeInstance, ensure the graph and prototype exist in the store first
                  if (pendingAction.action === 'addNodeInstance') {
                    const graphId = normalizeId(Array.isArray(pendingAction.params) ? pendingAction.params[0] : (pendingAction.params?.graphId), 'graphId');
                    const prototypeId = normalizeId(Array.isArray(pendingAction.params) ? pendingAction.params[1] : (pendingAction.params?.prototypeId), 'prototypeId');

                    console.log('🔍 MCP Bridge: Checking existence before action:', pendingAction.action, { graphId, prototypeId });

                    // Get current store state
                    const currentState = useGraphStore.getState();
                    const graphExists = graphId ? currentState.graphs.has(graphId) : true;
                    const prototypeExists = prototypeId ? currentState.nodePrototypes.has(prototypeId) : true;

                    console.log('🔍 MCP Bridge: Graph exists:', graphExists, 'Prototype exists:', prototypeExists);

                    if (!graphExists || !prototypeExists) {
                      console.warn('⚠️ MCP Bridge: Graph or prototype not found in store, attempting to sync from bridge...');

                      // Try to sync missing data from bridge server
                      try {
                        const bridgeResponse = await bridgeFetch('/api/bridge/state');
                        if (bridgeResponse.ok) {
                          const bridgeData = await bridgeResponse.json();

                          // Add missing prototype if it exists in bridge
                          if (!prototypeExists && bridgeData.nodePrototypes) {
                            const bridgePrototype = bridgeData.nodePrototypes.find(p => p.id === prototypeId);
                            if (bridgePrototype) {
                              console.log('🔄 MCP Bridge: Adding missing prototype from bridge:', bridgePrototype.name);
                              // Store API expects a single object; include id explicitly
                              currentState.addNodePrototype({
                                id: prototypeId,
                                name: bridgePrototype.name,
                                description: bridgePrototype.description,
                                color: bridgePrototype.color,
                                typeNodeId: bridgePrototype.typeNodeId,
                                definitionGraphIds: bridgePrototype.definitionGraphIds || []
                              });
                            }
                          }

                          // Ensure graph exists using ensureGraph if absent
                          if (!graphExists) {
                            try {
                              const gName = (bridgeData.graphs || []).find(g => g.id === graphId)?.name || 'New Graph';
                              await window.redstringStoreActions.ensureGraph(graphId, { name: gName });
                            } catch (egErr) {
                              console.warn('⚠️ MCP Bridge: ensureGraph failed:', egErr);
                            }
                          }
                        }
                      } catch (syncError) {
                        console.error('❌ MCP Bridge: Failed to sync from bridge:', syncError);
                      }

                      // Check again after sync attempt
                      const updatedState = useGraphStore.getState();
                      const graphExistsAfterSync = updatedState.graphs.has(graphId);
                      const prototypeExistsAfterSync = updatedState.nodePrototypes.has(prototypeId);

                      if (!graphExistsAfterSync || !prototypeExistsAfterSync) {
                        console.warn('⚠️ MCP Bridge: Graph or prototype still not found after sync, skipping instance creation');
                        // Send warning feedback
                        await bridgeFetch('/api/bridge/action-feedback', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            action: pendingAction.action,
                            status: 'warning',
                            error: `Graph or prototype not found in store after sync. Graph: ${graphExistsAfterSync}, Prototype: ${prototypeExistsAfterSync}`,
                            params: pendingAction.params
                          })
                        });
                        // Re-enqueue with exponential backoff (client-side timer)
                        try {
                          const backoff = Math.min(30000, ((pendingAction.meta?.retryDelayMs) || 1000) * 2);
                          setTimeout(async () => {
                            try {
                              await bridgeFetch('/api/bridge/pending-actions/enqueue', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ actions: [{ action: pendingAction.action, params: pendingAction.params }] })
                              });
                            } catch { }
                          }, backoff);
                        } catch { }
                        continue; // Skip this action for now
                      } else {
                        console.log('✅ MCP Bridge: Successfully synced missing data, proceeding with instance creation');
                      }
                    }
                  }

                  // Execute the action and get result
                  let result;
                  if (pendingAction.action === 'chat') {
                    const { message, context } = pendingAction.params;
                    result = await window.redstringStoreActions[pendingAction.action](message, context);
                    console.log('✅ MCP Bridge: Chat message forwarded:', result);
                  } else {
                    // For other actions that use array parameters
                    result = await window.redstringStoreActions[pendingAction.action](...(Array.isArray(pendingAction.params) ? pendingAction.params : [pendingAction.params]));
                  }
                  console.log('✅ MCP Bridge: Action completed successfully:', pendingAction.action, result);
                  try {
                    window.dispatchEvent(new CustomEvent('rs-telemetry', { detail: [{ ts: Date.now(), type: 'tool_call', name: pendingAction.action, args: pendingAction.params, status: 'completed', id: pendingAction.id }] }));
                  } catch { }
                  // Emit a brief chat update after executing
                  // DISABLED: This creates duplicate status messages
                  // The tool_call telemetry above already shows completion
                  /*
                  try {
                    const postText = (() => {
                      if (pendingAction.action === 'applyMutations' && Array.isArray(pendingAction.params?.[0])) {
                        const ops = pendingAction.params[0];
                        const created = ops.filter(o => o?.type === 'createNewGraph');
                        if (created.length > 0) {
                          const names = created.map(o => o?.initialData?.name).filter(Boolean);
                          if (names.length === 1) return `Created graph "${names[0]}".`;
                          if (names.length > 1) return `Created ${names.length} graphs.`;
                        }
                        return `Applied ${ops.length} change(s).`;
                      }
                      if (pendingAction.action === 'openGraph') return 'Opened the graph.';
                      if (pendingAction.action === 'addNodePrototype') return 'Created a new concept.';
                      return `Completed: ${pendingAction.action}.`;
                    })();
                    window.dispatchEvent(new CustomEvent('rs-telemetry', { detail: [{ ts: Date.now(), type: 'agent_answer', text: postText, cid: pendingAction.meta?.cid, id: pendingAction.id }] }));
                  } catch {}
                  */

                  // Acknowledge completion to bridge server if id exists
                  try {
                    if (pendingAction.id) {
                      // CRITICAL: Force an immediate state sync BEFORE acknowledging completion
                      // This ensures that when the MCP server follows up with a getRealRedstringState,
                      // it receives the absolute latest data from the store.
                      if (pendingAction.action !== 'chat' && pendingAction.action !== 'navigateTo') {
                        await sendStoreToServer().catch(err => console.warn('⚠️ MCP Bridge: Immediate state sync failed:', err));
                      }

                      await bridgeFetch('/api/bridge/action-completed', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ actionId: pendingAction.id, result })
                      });
                    }
                  } catch (ackErr) {
                    console.warn('⚠️ MCP Bridge: Failed to ack action completion:', ackErr);
                  }
                } else if (window.__rs_applyToolResultToStore) {
                  console.log('🔄 MCP Bridge: Routing action through global UI pipeline:', pendingAction.action);
                  let resultObj;

                  // Wrap params into a result-like object for applyToolResultToStore
                  // Most wizard tools just return the spec/params direct inside result
                  if (Array.isArray(pendingAction.params) && pendingAction.params.length === 1) {
                    resultObj = { action: pendingAction.action, ...pendingAction.params[0] };
                  } else {
                    resultObj = { action: pendingAction.action, ...pendingAction.params };
                  }

                  // Attempt execution via main UI pipeline
                  try {
                    window.__rs_applyToolResultToStore(pendingAction.action, resultObj, pendingAction.id);

                    // Emulate successful execution to clear it from the queue
                    try {
                      if (pendingAction.id) {
                        if (pendingAction.action !== 'chat' && pendingAction.action !== 'navigateTo') {
                          await sendStoreToServer().catch(err => console.warn('⚠️ MCP Bridge: Immediate state sync failed:', err));
                        }
                        await bridgeFetch('/api/bridge/action-completed', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ actionId: pendingAction.id, result: resultObj })
                        });
                      }
                      window.dispatchEvent(new CustomEvent('rs-telemetry', { detail: [{ ts: Date.now(), type: 'tool_call', name: pendingAction.action, args: pendingAction.params, status: 'completed', id: pendingAction.id }] }));
                    } catch (ackErr) {
                      console.warn('⚠️ MCP Bridge: Failed to ack delegated action completion:', ackErr);
                    }
                  } catch (pipelineErr) {
                    console.error('❌ MCP Bridge: UI Pipeline execution failed:', pipelineErr);
                    throw pipelineErr; // Let the outer catch handle the feedback
                  }
                } else {
                  console.error('❌ MCP Bridge: Action not found:', pendingAction.action);
                  // Send error feedback to bridge server
                  await bridgeFetch('/api/bridge/action-feedback', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      action: pendingAction.action,
                      status: 'error',
                      error: 'Action not found in window.redstringStoreActions or global pipeline'
                    })
                  });
                  try {
                    window.dispatchEvent(new CustomEvent('rs-telemetry', { detail: [{ ts: Date.now(), type: 'tool_call', name: pendingAction.action, args: pendingAction.params, status: 'failed', id: pendingAction.id }] }));
                  } catch { }
                }
              } catch (error) {
                console.error('❌ MCP Bridge: Failed to execute action:', pendingAction.action, error);
                // Send error feedback to bridge server
                try {
                  await bridgeFetch('/api/bridge/action-feedback', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      action: pendingAction.action,
                      status: 'error',
                      error: error.message,
                      params: pendingAction.params
                    })
                  });
                } catch (feedbackError) {
                  console.error('❌ MCP Bridge: Failed to send error feedback:', feedbackError);
                }
                try {
                  window.dispatchEvent(new CustomEvent('rs-telemetry', { detail: [{ ts: Date.now(), type: 'tool_call', name: pendingAction.action, args: pendingAction.params, status: 'failed', id: pendingAction.id }] }));
                } catch { }
              }
            }
          }
        }

        // Check telemetry and broadcast only NEW items
        try {
          if (!connectionStateRef.current.isConnected) {
            // Skip polling telemetry while disconnected
          } else {
            const telRes = await bridgeFetch('/api/bridge/telemetry');
            if (telRes.ok) {
              const tel = await telRes.json();
              if (Array.isArray(tel.telemetry) && tel.telemetry.length > 0) {
                const lastTs = lastTelemetryTsRef.current || 0;
                const newItems = tel.telemetry.filter(t => typeof t?.ts === 'number' && t.ts > lastTs);
                if (newItems.length > 0) {
                  window.dispatchEvent(new CustomEvent('rs-telemetry', { detail: newItems }));
                  const maxTs = Math.max(...tel.telemetry.map(t => typeof t?.ts === 'number' ? t.ts : 0));
                  lastTelemetryTsRef.current = Math.max(lastTs, maxTs);
                }
              }
            }
          }
        } catch { }
      } catch (error) {
        // Handle connection errors by entering reconnection mode to stop console spam
        const isConnectionError = error.message && (
          error.message.includes('fetch') ||
          error.message.includes('ECONNREFUSED') ||
          error.message.includes('Failed to fetch') ||
          error.message.includes('bridge_unavailable_cooldown') ||
          error.message.includes('NetworkError')
        );

        if (isConnectionError && connectionStateRef.current.isConnected) {
          console.log('🔌 MCP Bridge: Connection lost (polling failed), switching to reconnection mode');
          connectionStateRef.current.isConnected = false;
          startReconnection();
        }
      }
    };

    // Check for bridge updates every 250ms; guard with mountedRef to auto-resume after remounts
    // Adaptive polling loop
    const pollingLoop = async () => {
      if (!mountedRef.current) return;

      const now = Date.now();
      const timeSinceActivity = now - lastActivityRef.current;
      const isIdle = timeSinceActivity > 15000; // 15 seconds idle
      const isDeeplyIdle = timeSinceActivity > 60000; // 60 seconds idle

      // Adaptive polling based on activity level
      let interval = 500; // 500ms when active
      if (isDeeplyIdle) {
        interval = 5000; // 5s when completely idle
      } else if (isIdle) {
        interval = 2000; // 2s when getting idle
      }

      await checkForBridgeUpdates();

      if (mountedRef.current && connectionStateRef.current.isConnected) {
        bridgeIntervalRef.current = setTimeout(pollingLoop, interval);
      } else if (mountedRef.current) {
        // If disconnected, check less frequently but keep checking to resume
        bridgeIntervalRef.current = setTimeout(pollingLoop, 5000);
      }
    };

    // Start the loop
    pollingLoop();

    // Cleanup function
    return () => {
      if (dataIntervalRef.current) {
        clearInterval(dataIntervalRef.current);
        dataIntervalRef.current = null;
      }
      if (bridgeIntervalRef.current) {
        clearInterval(bridgeIntervalRef.current);
        bridgeIntervalRef.current = null;
      }

      // Clean up reconnection interval
      if (reconnectIntervalRef.current) {
        clearInterval(reconnectIntervalRef.current);
        reconnectIntervalRef.current = null;
      }
    };
  }, []);

  // ── Daemon coexistence (Phase 6) ──────────────────────────────────────────
  // When a headless daemon is running, it owns the universe file. This controller
  // hydrates the browser from the daemon, suspends local file writes, forwards
  // edits, and re-hydrates on daemon-side changes. Inert when no daemon: tick()
  // just fails the health probe and never engages.
  useEffect(() => {
    const coexistence = createDaemonCoexistence({
      useGraphStore,
      saveCoordinator,
      bridgeFetch,
      exportToRedstring,
      log: (...a) => console.log('[BridgeClient]', ...a)
    });
    coexistence.start();
    return () => coexistence.stop();
  }, []);

  // This component doesn't render anything visible
  return null;
};

export default BridgeClient; 
