import { useEffect, useRef } from 'react';
import useGraphStore from '../store/graphStore.jsx';
import { bridgeEventSource, bridgeFetch } from '../services/bridgeConfig.js';

const MAX_LAYOUT_NODES = 400;
const MAX_SUMMARY_EDGES = 600;

const safePrototypeName = (prototypes, prototypeId) => {
  if (!prototypeId) return 'Unknown Prototype';
  const proto = prototypes.get(prototypeId);
  return proto?.name || prototypeId;
};

const computeGraphQuality = (nodeCount, edgeCount) => {
  if (nodeCount === 0) {
    return { label: 'empty', score: 0, density: 0 };
  }
  if (nodeCount === 1) {
    return { label: 'single', score: 10, density: 0 };
  }
  const density = edgeCount / (nodeCount * (nodeCount - 1));
  let label = 'sparse';
  if (density >= 0.45) label = 'dense';
  else if (density >= 0.18) label = 'balanced';
  else if (density === 0) label = 'disconnected';
  const score = Math.max(5, Math.min(100, Math.round((density * 80) + Math.min(nodeCount * 2, 40))));
  return { label, score, density: Number(density.toFixed(3)) };
};

const buildGraphLayouts = (state) => {
  const layouts = {};
  for (const [graphId, graph] of state.graphs.entries()) {
    const instances = graph?.instances instanceof Map ? Array.from(graph.instances.entries()) : [];
    if (!instances.length) {
      layouts[graphId] = {
        nodes: {},
        metadata: {
          nodeCount: 0,
          edgeCount: Array.isArray(graph?.edgeIds) ? graph.edgeIds.length : 0,
          boundingBox: null,
          centroid: null,
          computedAt: Date.now(),
          truncated: false
        }
      };
      continue;
    }

    const nodes = {};
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let totalX = 0;
    let totalY = 0;
    let counted = 0;

    instances.forEach(([instanceId, instance], index) => {
      if (!instance || typeof instance !== 'object') return;
      const { x = 0, y = 0, scale = 1, prototypeId = null } = instance;
      if (index < MAX_LAYOUT_NODES) {
        nodes[instanceId] = { x, y, scale, prototypeId };
      }
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      totalX += x;
      totalY += y;
      counted += 1;
    });

    const edgeCount = Array.isArray(graph?.edgeIds) ? graph.edgeIds.length : 0;
    const truncated = instances.length > MAX_LAYOUT_NODES;
    layouts[graphId] = {
      nodes,
      metadata: {
        nodeCount: instances.length,
        edgeCount,
        boundingBox: counted ? { minX, minY, maxX, maxY } : null,
        centroid: counted ? { x: totalX / counted, y: totalY / counted } : null,
        computedAt: Date.now(),
        truncated
      }
    };
  }
  return layouts;
};

const buildGraphSummaries = (state) => {
  const summaries = {};
  const prototypes = state.nodePrototypes || new Map();
  const edgesMap = state.edges || new Map();

  for (const [graphId, graph] of state.graphs.entries()) {
    const instances = graph?.instances instanceof Map ? Array.from(graph.instances.entries()) : [];
    const instanceById = new Map(instances);
    const nodes = instances.slice(0, MAX_LAYOUT_NODES).map(([instanceId, instance]) => ({
      id: instanceId,
      prototypeId: instance?.prototypeId || null,
      name: safePrototypeName(prototypes, instance?.prototypeId)
    }));

    const edgeIds = Array.isArray(graph?.edgeIds) ? graph.edgeIds : [];
    const edges = edgeIds
      .map(edgeId => edgesMap.get(edgeId))
      .filter(Boolean);

    const edgesSerialized = edges.slice(0, MAX_SUMMARY_EDGES).map(edge => {
      const sourceInstance = instanceById.get(edge.sourceId);
      const targetInstance = instanceById.get(edge.destinationId);
      return {
        id: edge.id,
        from: edge.sourceId,
        to: edge.destinationId,
        type: safePrototypeName(prototypes, edge.typeNodeId),
        sourceLabel: safePrototypeName(prototypes, sourceInstance?.prototypeId),
        targetLabel: safePrototypeName(prototypes, targetInstance?.prototypeId)
      };
    });

    const quality = computeGraphQuality(instances.length, edges.length);

    const textLines = [
      `Graph: ${graph?.name || 'Untitled'} (${graphId})`,
      `Nodes (${instances.length} total${instances.length > MAX_LAYOUT_NODES ? `, showing ${MAX_LAYOUT_NODES}` : ''}):`
    ];
    nodes.forEach(node => {
      textLines.push(`- ${node.name} [${node.id}]`);
    });

    textLines.push('', `Edges (${edges.length} total${edges.length > MAX_SUMMARY_EDGES ? `, showing ${MAX_SUMMARY_EDGES}` : ''}):`);
    edgesSerialized.forEach(edge => {
      const relation = edge.type ? ` (${edge.type})` : '';
      textLines.push(`- ${edge.sourceLabel} → ${edge.targetLabel}${relation}`);
    });

    summaries[graphId] = {
      id: graphId,
      name: graph?.name || 'Untitled Graph',
      description: graph?.description || '',
      nodeCount: instances.length,
      edgeCount: edges.length,
      density: quality.density,
      quality: quality.label,
      score: quality.score,
      nodes,
      edges: edgesSerialized,
      text: textLines.join('\n'),
      computedAt: Date.now()
    };
  }

  return summaries;
};

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

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    // Function to check bridge server health
    const checkBridgeHealth = async () => {
      try {
        const response = await bridgeFetch('/api/bridge/health');
        return response.ok;
      } catch (error) {
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
          await registerStoreActions();
          await sendStoreToServer();
          
           // Restart normal polling
           if (dataIntervalRef.current) {
             clearInterval(dataIntervalRef.current);
           }
           dataIntervalRef.current = setInterval(sendStoreToServer, 10000);
          
          console.log('🎉 MCP Bridge: Connection fully restored!');
          // Ensure SSE is established only when connected
          try {
            if (!eventSourceRef.current) {
              const es = bridgeEventSource('/events/stream');
              eventSourceRef.current = es;
              es.addEventListener('PATCH_APPLIED', () => {});
              es.onerror = () => { try { es.close(); } catch {}; eventSourceRef.current = null; };
            }
          } catch {}
        } catch (error) {
          console.error('❌ MCP Bridge: Failed to re-establish full connection:', error);
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
          console.log(`⏳ MCP Bridge: Next reconnection attempt in ${nextAttemptDelay/1000}s - this is normal if the bridge connector isn't running`);
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
      } catch {}
      
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
          }
        };

        // Store the actual functions in a global variable that the bridge server can access
        if (typeof window !== 'undefined') {
          window.redstringStoreActions = {
            ensureGraph: async (graphId, initialData) => {
              console.log('MCPBridge: Calling ensureGraph', graphId, initialData);
              const st = useGraphStore.getState();
              if (!st.graphs.has(graphId)) {
                st.createGraphWithId(graphId, initialData || {});
              }
              return { success: true, graphId };
            },
            addNodePrototype: async (prototypeId, prototypeData) => {
              console.log('MCPBridge: Calling addNodePrototype', prototypeId, prototypeData);
              // Ensure the prototypeData has the correct id
              const dataWithId = { ...prototypeData, id: prototypeId };
              state.addNodePrototype(dataWithId);
              try {
                const protoName = String(dataWithId?.name || 'Concept');
                const evt = [{ ts: Date.now(), type: 'info', name: 'addNodePrototype', message: `Created concept "${protoName}"` }];
                window.dispatchEvent(new CustomEvent('rs-telemetry', { detail: evt }));
              } catch {}
              return { success: true, prototypeId };
            },
            addNodeInstance: async (graphId, prototypeId, position, instanceId) => {
              console.log('MCPBridge: Calling addNodeInstance', graphId, prototypeId, position, instanceId);
              state.addNodeInstance(graphId, prototypeId, position, instanceId);
              return { success: true, instanceId };
            },
            removeNodeInstance: async (graphId, instanceId) => {
              console.log('MCPBridge: Calling removeNodeInstance', graphId, instanceId);
              state.removeNodeInstance(graphId, instanceId);
              return { success: true, instanceId };
            },
            updateNodePrototype: async (prototypeId, updates) => {
              console.log('MCPBridge: Calling updateNodePrototype', prototypeId, updates);
              state.updateNodePrototype(prototypeId, (prototype) => {
                Object.assign(prototype, updates);
              });
              return { success: true, prototypeId };
            },
            setActiveGraph: async (graphId) => {
              console.log('MCPBridge: Calling setActiveGraph', graphId);
              state.setActiveGraph(graphId);
              try {
                const s = useGraphStore.getState();
                const g = s.graphs.get(graphId);
                const friendly = `Switched to graph "${g?.name || graphId}"`;
                window.dispatchEvent(new CustomEvent('rs-telemetry', { detail: [{ ts: Date.now(), type: 'info', name: 'setActiveGraph', message: friendly }] }));
              } catch {}
              return { success: true, graphId };
            },
            openGraph: async (graphId) => {
              console.log('MCPBridge: Calling openGraphTab', graphId);
              state.openGraphTab(graphId);
              try {
                const s = useGraphStore.getState();
                const g = s.graphs.get(graphId);
                const friendly = `Opened graph "${g?.name || graphId}"`;
                window.dispatchEvent(new CustomEvent('rs-telemetry', { detail: [{ ts: Date.now(), type: 'info', name: 'openGraph', message: friendly }] }));
                // Immediately sync bridge state so /api/ai/agent sees the active graph without delay
                try {
                  const bridgeData = {
                    graphs: Array.from(s.graphs.entries()).map(([id, graph]) => ({
                      id,
                      name: graph.name,
                      description: graph.description || '',
                      instanceCount: graph.instances?.size || 0,
                      instances: id === s.activeGraphId && graph.instances ?
                        Object.fromEntries(Array.from(graph.instances.entries()).map(([instanceId, instance]) => [
                          instanceId, {
                            id: instance.id,
                            prototypeId: instance.prototypeId,
                            x: instance.x || 0,
                            y: instance.y || 0,
                            scale: instance.scale || 1
                          }
                        ])) : undefined
                    })),
                    nodePrototypes: Array.from(s.nodePrototypes.entries()).map(([nid, prototype]) => ({ id: nid, name: prototype.name })),
                    activeGraphId: s.activeGraphId,
                    activeGraphName: s.activeGraphId ? (s.graphs.get(s.activeGraphId)?.name || null) : null,
                    openGraphIds: s.openGraphIds,
                    summary: {
                      totalGraphs: s.graphs.size,
                      totalPrototypes: s.nodePrototypes.size,
                      lastUpdate: Date.now()
                    }
                  };
                  await bridgeFetch('/api/bridge/state', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(bridgeData)
                  });
                } catch {}
              } catch {}
              return { success: true, graphId };
            },
              createNewGraph: async (initialData) => {
                console.log('MCPBridge: Calling createNewGraph', initialData);
                const beforeId = state.activeGraphId;
                state.createNewGraph(initialData || {});
                const afterId = useGraphStore.getState().activeGraphId;
                try {
                  const s2 = useGraphStore.getState();
                  const g = afterId ? s2.graphs.get(afterId) : null;
                  const friendly = `Created graph "${g?.name || 'New Thing'}" (${afterId || 'unknown'})`;
                  window.dispatchEvent(new CustomEvent('rs-telemetry', { detail: [{ ts: Date.now(), type: 'info', name: 'createNewGraph', message: friendly, graphId: afterId }] }));
                } catch {}
                return { success: true, graphId: afterId || beforeId };
              },
              createAndAssignGraphDefinition: async (prototypeId) => {
                console.log('MCPBridge: Calling createAndAssignGraphDefinition', prototypeId);
                const graphId = state.createAndAssignGraphDefinition(prototypeId);
                return { success: true, graphId, prototypeId };
              },
              openRightPanelNodeTab: async (nodeId) => {
                console.log('MCPBridge: Calling openRightPanelNodeTab', nodeId);
                state.openRightPanelNodeTab(nodeId);
                return { success: true, nodeId };
              },
              addEdge: async (graphId, edgeData) => {
                console.log('MCPBridge: Calling addEdge', graphId, edgeData);
                state.addEdge(graphId, edgeData);
                return { success: true, edgeId: edgeData.id };
              },
              updateEdgeDirectionality: async (edgeId, arrowsToward) => {
                console.log('MCPBridge: Calling updateEdgeDirectionality', edgeId, arrowsToward);
                state.updateEdge(edgeId, (edge) => {
                  edge.directionality = {
                    arrowsToward: new Set(Array.isArray(arrowsToward) ? arrowsToward : [])
                  };
                });
                return { success: true, edgeId };
              },
              addToAbstractionChain: async (nodeId, dimension, direction, newNodeId, insertRelativeToNodeId) => {
                console.log('MCPBridge: Calling addToAbstractionChain', { nodeId, dimension, direction, newNodeId, insertRelativeToNodeId });
                state.addToAbstractionChain(nodeId, dimension, direction, newNodeId, insertRelativeToNodeId);
                return { success: true };
              },
              removeFromAbstractionChain: async (nodeId, dimension, nodeToRemove) => {
                console.log('MCPBridge: Calling removeFromAbstractionChain', { nodeId, dimension, nodeToRemove });
                state.removeFromAbstractionChain(nodeId, dimension, nodeToRemove);
                return { success: true };
              },
              swapNodeInChain: async (currentNodeId, newNodeId) => {
                console.log('MCPBridge: Calling swapNodeInChain', currentNodeId, newNodeId);
                state.swapNodeInChain(currentNodeId, newNodeId);
                return { success: true };
              },
              setNodeType: async (nodeId, typeNodeId) => {
                console.log('MCPBridge: Calling setNodeType', nodeId, typeNodeId);
                state.setNodeType(nodeId, typeNodeId);
                return { success: true };
              },
              closeGraphTab: async (graphId) => {
                console.log('MCPBridge: Calling closeGraphTab', graphId);
                state.closeGraphTab(graphId);
                return { success: true };
              },
            chat: async (message, context) => {
              console.log('MCPBridge: Forwarding chat message to AI model', { message, context });
              // The actual chat handling happens in the MCP server
              return { success: true, message, context };
              },
              applyMutations: async (operations) => {
                console.groupCollapsed('MCPBridge: Applying batch mutations');
                console.log('Operation count:', operations?.length || 0);
                console.log('Operations:', operations);
                const store = useGraphStore.getState();
                const results = [];
                // Helper: sync prototype from bridge state if missing
                const ensurePrototype = async (prototypeId) => {
                  const st = useGraphStore.getState();
                  if (st.nodePrototypes.has(prototypeId)) return true;
                  try {
                    const resp = await bridgeFetch('/api/bridge/state');
                    if (!resp.ok) return false;
                    const b = await resp.json();
                    const p = Array.isArray(b.nodePrototypes) ? b.nodePrototypes.find(x => x.id === prototypeId) : null;
                    if (p) {
                      st.addNodePrototype({
                        id: prototypeId,
                        name: p.name,
                        description: p.description || '',
                        color: p.color || '#3B82F6',
                        typeNodeId: p.typeNodeId || null,
                        definitionGraphIds: p.definitionGraphIds || []
                      });
                      console.log('MCPBridge: ensurePrototype added missing prototype', p.name, prototypeId);
                      return true;
                    }
                  } catch {}
                  return false;
                };
                for (const op of (operations || [])) {
                  try {
                    switch (op.type) {
                      case 'addNodeInstance': {
                        const st = useGraphStore.getState();
                        let graph = st.graphs.get(op.graphId);
                        let protoExists = st.nodePrototypes.has(op.prototypeId);
                        if (!protoExists) {
                          protoExists = await ensurePrototype(op.prototypeId);
                        }
                        if (!graph || !protoExists) {
                          console.warn('MCPBridge: Skipping addNodeInstance due to missing graph/prototype', { graphExists: !!graph, protoExists, graphId: op.graphId, prototypeId: op.prototypeId });
                          results.push({ type: op.type, ok: false, id: op.instanceId, error: 'Missing graph/prototype' });
                          break;
                        }
                        const beforeCount = (st.graphs.get(op.graphId)?.instances?.size) || 0;
                        st.addNodeInstance(op.graphId, op.prototypeId, op.position, op.instanceId);
                        try {
                          const s2 = useGraphStore.getState();
                          const g = s2.graphs.get(op.graphId);
                          const proto = s2.nodePrototypes.get(op.prototypeId);
                          const friendly = `Added "${proto?.name || 'Concept'}" to "${g?.name || 'Graph'}" at (${Math.round(op.position?.x ?? 0)}, ${Math.round(op.position?.y ?? 0)})`;
                          window.dispatchEvent(new CustomEvent('rs-telemetry', { detail: [{ ts: Date.now(), type: 'info', name: 'applyMutations', message: friendly }] }));
                          const afterCount = (g?.instances?.size) || 0;
                          console.log('MCPBridge: addNodeInstance applied', { graphId: op.graphId, instanceId: op.instanceId, position: op.position, instanceCountBefore: beforeCount, instanceCountAfter: afterCount });
                        } catch {}
                        results.push({ type: op.type, ok: true, id: op.instanceId });
                        break;
                      }
                      case 'addEdge': {
                        const st = useGraphStore.getState();
                        const g = st.graphs.get(op.graphId);
                        const ok = !!(g && g.instances && g.instances.has(op.edgeData?.sourceId) && g.instances.has(op.edgeData?.destinationId));
                        if (!ok) {
                          results.push({ type: op.type, ok: false, id: op.edgeData?.id, error: 'Missing instances/graph' });
                          break;
                        }
                        st.addEdge(op.graphId, op.edgeData);
                        try {
                          const s2 = useGraphStore.getState();
                          const gi = s2.graphs.get(op.graphId);
                          const srcInst = gi?.instances?.get(op.edgeData?.sourceId);
                          const dstInst = gi?.instances?.get(op.edgeData?.destinationId);
                          const srcProto = srcInst ? s2.nodePrototypes.get(srcInst.prototypeId) : null;
                          const dstProto = dstInst ? s2.nodePrototypes.get(dstInst.prototypeId) : null;
                          const friendly = `Connected "${srcProto?.name || 'A'}" → "${dstProto?.name || 'B'}"`;
                          window.dispatchEvent(new CustomEvent('rs-telemetry', { detail: [{ ts: Date.now(), type: 'info', name: 'applyMutations', message: friendly }] }));
                        } catch {}
                        results.push({ type: op.type, ok: true, id: op.edgeData?.id });
                        break;
                      }
                      case 'moveNodeInstance': {
                        const st = useGraphStore.getState();
                        const g = st.graphs.get(op.graphId);
                        const exists = !!(g && g.instances && g.instances.get(op.instanceId));
                        if (!exists) {
                          results.push({ type: op.type, ok: false, id: op.instanceId, error: 'Missing instance/graph' });
                          break;
                        }
                        st.updateNodeInstance(op.graphId, op.instanceId, (inst) => { inst.x = op.position.x; inst.y = op.position.y; });
                        try {
                          const s2 = useGraphStore.getState();
                          const g2 = s2.graphs.get(op.graphId);
                          const inst2 = g2?.instances?.get(op.instanceId);
                          const proto = inst2 ? s2.nodePrototypes.get(inst2.prototypeId) : null;
                          const friendly = `Moved "${proto?.name || 'Concept'}" to (${Math.round(op.position?.x ?? 0)}, ${Math.round(op.position?.y ?? 0)})`;
                          window.dispatchEvent(new CustomEvent('rs-telemetry', { detail: [{ ts: Date.now(), type: 'info', name: 'applyMutations', message: friendly }] }));
                          console.log('MCPBridge: moveNodeInstance applied', { graphId: op.graphId, instanceId: op.instanceId, position: op.position, instanceCount: g2?.instances?.size });
                        } catch {}
                        results.push({ type: op.type, ok: true, id: op.instanceId });
                        break;
                      }
                      case 'updateEdgeDirectionality': {
                        const st = useGraphStore.getState();
                        const edgeExists = st.edges.has(op.edgeId);
                        if (!edgeExists) {
                          results.push({ type: op.type, ok: false, id: op.edgeId, error: 'Missing edge' });
                          break;
                        }
                        st.updateEdge(op.edgeId, (edge) => {
                          edge.directionality = { arrowsToward: new Set(Array.isArray(op.arrowsToward) ? op.arrowsToward : []) };
                        });
                        try {
                          window.dispatchEvent(new CustomEvent('rs-telemetry', { detail: [{ ts: Date.now(), type: 'info', name: 'applyMutations', message: 'Updated connection direction' }] }));
                        } catch {}
                        results.push({ type: op.type, ok: true, id: op.edgeId });
                        break;
                      }
                      case 'updateGraph': {
                        const st = useGraphStore.getState();
                        const g = st.graphs.get(op.graphId);
                        if (!g) {
                          results.push({ type: op.type, ok: false, id: op.graphId, error: 'Missing graph' });
                          break;
                        }
                        st.updateGraph(op.graphId, (graph) => {
                          if (typeof op.updates?.name === 'string') graph.name = op.updates.name;
                          if (typeof op.updates?.color === 'string') graph.color = op.updates.color;
                        });
                        try {
                          const s2 = useGraphStore.getState();
                          const g2 = s2.graphs.get(op.graphId);
                          const friendly = `Updated graph "${g2?.name || op.graphId}"`;
                          window.dispatchEvent(new CustomEvent('rs-telemetry', { detail: [{ ts: Date.now(), type: 'info', name: 'applyMutations', message: friendly }] }));
                        } catch {}
                        results.push({ type: op.type, ok: true, id: op.graphId });
                        break;
                      }
                      case 'updateNodePrototype': {
                        const st = useGraphStore.getState();
                        const exists = st.nodePrototypes.has(op.prototypeId);
                        if (!exists) {
                          results.push({ type: op.type, ok: false, id: op.prototypeId, error: 'Missing prototype' });
                          break;
                        }
                        st.updateNodePrototype(op.prototypeId, (prototype) => {
                          if (typeof op.updates?.name === 'string') prototype.name = op.updates.name;
                          if (typeof op.updates?.color === 'string') prototype.color = op.updates.color;
                          if (typeof op.updates?.description === 'string') prototype.description = op.updates.description;
                        });
                        try {
                          const s2 = useGraphStore.getState();
                          const p2 = s2.nodePrototypes.get(op.prototypeId);
                          const friendly = `Updated concept "${p2?.name || op.prototypeId}"`;
                          window.dispatchEvent(new CustomEvent('rs-telemetry', { detail: [{ ts: Date.now(), type: 'info', name: 'applyMutations', message: friendly }] }));
                        } catch {}
                        results.push({ type: op.type, ok: true, id: op.prototypeId });
                        break;
                      }
                      case 'openRightPanelNodeTab':
                        store.openRightPanelNodeTab(op.nodeId);
                        results.push({ type: op.type, ok: true, id: op.nodeId });
                        break;
                      case 'addToAbstractionChain':
                        store.addToAbstractionChain(op.nodeId, op.dimension, op.direction, op.newNodeId, op.insertRelativeToNodeId);
                        results.push({ type: op.type, ok: true });
                        break;
                      case 'removeFromAbstractionChain':
                        store.removeFromAbstractionChain(op.nodeId, op.dimension, op.nodeToRemove);
                        results.push({ type: op.type, ok: true });
                        break;
                      case 'swapNodeInChain':
                        store.swapNodeInChain(op.currentNodeId, op.newNodeId);
                        results.push({ type: op.type, ok: true });
                        break;
                      case 'setNodeType':
                        store.setNodeType(op.nodeId, op.typeNodeId);
                        results.push({ type: op.type, ok: true });
                        break;
                      case 'closeGraphTab':
                        store.closeGraphTab(op.graphId);
                        results.push({ type: op.type, ok: true });
                        break;
                      case 'createNewGraph': {
                        const init = op.initialData || {};
                        if (init.id) {
                          store.createGraphWithId(init.id, init);
                          try { store.openGraphTab(init.id); } catch {}
                        } else {
                          store.createNewGraph(init);
                        }
                        try {
                          const s2 = useGraphStore.getState();
                          const gid = s2.activeGraphId;
                          const g = gid ? s2.graphs.get(gid) : null;
                          const friendly = `Created graph "${g?.name || 'New Graph'}"`;
                          window.dispatchEvent(new CustomEvent('rs-telemetry', { detail: [{ ts: Date.now(), type: 'info', name: 'applyMutations', message: friendly }] }));
                        } catch {}
                        results.push({ type: op.type, ok: true });
                        break;
                      }
                      case 'createAndAssignGraphDefinition':
                        store.createAndAssignGraphDefinition(op.prototypeId);
                        results.push({ type: op.type, ok: true, id: op.prototypeId });
                        break;
                      default:
                        results.push({ type: op.type, ok: false, error: 'Unknown operation type' });
                    }
                  } catch (err) {
                    results.push({ type: op.type, ok: false, error: String(err?.message || err) });
                  }
                }
                try {
                  const s = useGraphStore.getState();
                  const a = s.activeGraphId;
                  const g = a ? s.graphs.get(a) : null;
                  console.log('MCPBridge: applyMutations summary', { activeGraphId: a, activeInstanceCount: g?.instances?.size, totalGraphs: s.graphs.size });
                } catch {}
                console.groupEnd();
                return { success: true, results };
            }
          };
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
        } catch {}
        
        // Send only minimal essential data to keep payload small
        const bridgeData = {
          // Graph data with instance positions for spatial reasoning
          graphs: Array.from(state.graphs.entries()).map(([id, graph]) => ({
            id,
            name: graph.name,
            description: graph.description || '',
            instanceCount: graph.instances?.size || 0,
            // Include instance data for spatial reasoning (only for active graph to keep payload small)
            instances: id === state.activeGraphId && graph.instances ? 
              Object.fromEntries(Array.from(graph.instances.entries()).map(([instanceId, instance]) => [
                instanceId, {
                  id: instance.id,
                  prototypeId: instance.prototypeId,
                  x: instance.x || 0,
                  y: instance.y || 0,
                  scale: instance.scale || 1
                }
              ])) : undefined
          })),
          
          // Only essential prototype info (send all; previously truncated to 50 caused sync issues)
          nodePrototypes: Array.from(state.nodePrototypes.entries()).map(([id, prototype]) => ({
            id,
            name: prototype.name
          })),
          
          // UI state
          activeGraphId: state.activeGraphId,
          activeGraphName: state.activeGraphId ? (state.graphs.get(state.activeGraphId)?.name || null) : null,
          openGraphIds: state.openGraphIds,
          // File status (optional)
          fileStatus,
          
          // Summary stats
          summary: {
            totalGraphs: state.graphs.size,
            totalPrototypes: state.nodePrototypes.size,
            lastUpdate: Date.now()
          },
          graphLayouts: layouts,
          graphSummaries: summaries
        };

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
            es.addEventListener('PATCH_APPLIED', () => {});
            es.onerror = () => { try { es.close(); } catch {}; eventSourceRef.current = null; };
          }
        } catch {}
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
        } catch {}
        try {
          const mod = require('../services/bridgeConfig.js');
          if (mod && typeof mod.resetBridgeBackoff === 'function') {
            mod.resetBridgeBackoff();
          }
        } catch {}
        const st = connectionStateRef.current;
        st.reconnectAttempts = 0;
        st.isConnected = false;
        startReconnection();
      };
    } catch {}

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
      } catch {}
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
            console.log('✅ MCP Bridge: Found pending actions:', actionsData.pendingActions.length);
            // Execute actions in a stable dependency-friendly order
            const priority = (act) => {
              if (act.action === 'applyMutations') {
                const ops = Array.isArray(act.params?.[0]) ? act.params[0] : [];
                const creates = ops.some(o => o && o.type === 'createNewGraph');
                return creates ? 1 : 4;
              }
              switch (act.action) {
                case 'createNewGraph': return 0;
                case 'addNodePrototype': return 1;
                case 'openGraph': return 2;
                case 'setActiveGraph': return 3;
                default: return 5;
              }
            };
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
                  } catch {}
                  window.dispatchEvent(new CustomEvent('rs-telemetry', { detail: [{ ts: Date.now(), type: 'tool_call', name: pendingAction.action, args: pendingAction.params, status: 'running', id: pendingAction.id }] }));
                } catch {}
                // Also emit a brief chat update before executing
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
                if (window.redstringStoreActions && window.redstringStoreActions[pendingAction.action]) {
                  console.log('✅ MCP Bridge: Executing action:', pendingAction.action, pendingAction.params);
                  
                  // Special handling: openGraph with missing graph should be deferred
                  if (pendingAction.action === 'openGraph') {
                    try {
                      const gid = Array.isArray(pendingAction.params) ? pendingAction.params[0] : pendingAction.params;
                      const stBefore = useGraphStore.getState();
                      if (!stBefore.graphs.has(gid)) {
                        // Try ensureGraph based on bridge data
                        const bridgeResponse = await bridgeFetch('/api/bridge/state');
                        if (bridgeResponse.ok) {
                          const b = await bridgeResponse.json();
                          const existsInBridge = Array.isArray(b.graphs) && b.graphs.some(g => g.id === gid);
                          if (existsInBridge && window.redstringStoreActions.ensureGraph) {
                            await window.redstringStoreActions.ensureGraph(gid, { name: (b.graphs.find(g => g.id===gid)?.name)||'New Graph' });
                          }
                        }
                        const stAfter = useGraphStore.getState();
                        if (!stAfter.graphs.has(gid)) {
                          // Re-enqueue with short backoff and skip now
                          try {
                            setTimeout(async () => {
                              await bridgeFetch('/api/bridge/pending-actions/enqueue', {
                                method: 'POST', headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ actions: [ { action: 'openGraph', params: [gid] } ] })
                              });
                            }, 400);
                          } catch {}
                          // Mark as completed-noop so chat doesn't hang
                          try { window.dispatchEvent(new CustomEvent('rs-telemetry', { detail: [{ ts: Date.now(), type: 'tool_call', name: 'openGraph', status: 'completed', id: pendingAction.id }] })); } catch {}
                          continue;
                        }
                      }
                    } catch {}
                  }

                  // For addNodeInstance, ensure the graph and prototype exist in the store first
                  if (pendingAction.action === 'addNodeInstance') {
                    const [graphId, prototypeId, position, instanceId] = pendingAction.params;
                    console.log('🔍 MCP Bridge: Checking if graph and prototype exist before adding instance...');
                    
                    // Get current store state
                    const currentState = useGraphStore.getState();
                    const graphExists = currentState.graphs.has(graphId);
                    const prototypeExists = currentState.nodePrototypes.has(prototypeId);
                    
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
                                body: JSON.stringify({ actions: [ { action: pendingAction.action, params: pendingAction.params } ] })
                              });
                            } catch {}
                          }, backoff);
                        } catch {}
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
                  } catch {}
                  // Emit a brief chat update after executing
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

                  // Acknowledge completion to bridge server if id exists
                  try {
                    if (pendingAction.id) {
                      await bridgeFetch('/api/bridge/action-completed', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ actionId: pendingAction.id, result })
                      });
                    }
                  } catch (ackErr) {
                    console.warn('⚠️ MCP Bridge: Failed to ack action completion:', ackErr);
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
                      error: 'Action not found in window.redstringStoreActions'
                    })
                  });
                  try {
                    window.dispatchEvent(new CustomEvent('rs-telemetry', { detail: [{ ts: Date.now(), type: 'tool_call', name: pendingAction.action, args: pendingAction.params, status: 'failed', id: pendingAction.id }] }));
                  } catch {}
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
                } catch {}
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
        } catch {}
      } catch (error) {
        // Ignore errors - this is just a polling mechanism
      }
    };
    
    // Check for bridge updates every 1s; guard with mountedRef to auto-resume after remounts
    bridgeIntervalRef.current = setInterval(() => {
      if (mountedRef.current) checkForBridgeUpdates();
    }, 1000);

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

  // This component doesn't render anything visible
  return null;
};

export default BridgeClient; 
