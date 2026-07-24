import { create } from 'zustand';
import { produce as immerProduce, produceWithPatches, applyPatches, enableMapSet, enablePatches } from 'immer';

// Global listener for patches, used by middleware to capture changes from actions
let patchListener = null;

/**
 * Custom produce wrapper to capture patches from existing actions.
 * This allows us to "spy" on state changes without refactoring all 3500+ lines of action code.
 */
const produce = (arg1, arg2) => {
  // Overload 1: Curried producer -> produce(recipe) => (state) => newState
  // This is the pattern used by 99% of actions: set(produce(draft => ...))
  if (typeof arg1 === 'function' && typeof arg2 === 'undefined') {
    const recipe = arg1;
    return (state) => {
      const [next, patches, inverse] = produceWithPatches(state, recipe);
      if (patchListener) patchListener(patches, inverse);
      return next;
    }
  }
  // Overload 2: Direct producer -> produce(state, recipe) => newState
  else {
    const [next, patches, inverse] = produceWithPatches(arg1, arg2);
    if (patchListener) patchListener(patches, inverse);
    return next;
  }
};
import { v4 as uuidv4 } from 'uuid';
import { NODE_WIDTH, NODE_HEIGHT, NODE_DEFAULT_COLOR } from '../constants.js';
import { getFileStatus, restoreLastSession, clearSession, notifyChanges } from './fileStorage.js';
import { importFromRedstring } from '../formats/redstringFormat.js';
import { MAX_LAYOUT_SCALE_MULTIPLIER } from '../services/graphLayoutService.js';
import { debugLogSync } from '../utils/debugLogger.js';
import useHistoryStore from './historyStore.js';
import { generateDescription } from '../utils/actionDescriptions.js';

/**
 * @module graphStore
 * @description Zustand store for all Redstring graph state. Uses Immer for immutable
 * updates and a custom `produce` wrapper that captures patches for the undo/redo history system.
 *
 * **Architecture layers:**
 * - **Prototypes** (`nodePrototypes` Map): Node type definitions — name, color, description, definition graph IDs.
 * - **Graphs** (`graphs` Map): Each graph holds node `instances` (position/scale) and `edgeIds`.
 * - **Edges** (`edges` Map): Edge objects referencing source/destination instance IDs.
 * - **UI state**: Active graph, viewport, panel layout, selection, PieMenu, settings.
 *
 * All mutations use `set(produce(draft => ...))` via Immer. The middleware wrapping
 * intercepts every `set` call to capture patches for history and notify SaveCoordinator.
 */

/**
 * @typedef {Object} NodePrototype
 * @property {string} id - UUID.
 * @property {string} name - Display name.
 * @property {string} [description] - Description text.
 * @property {string} color - Hex color string.
 * @property {string|null} typeNodeId - ID of the prototype that types this one (null = base type).
 * @property {string[]} definitionGraphIds - IDs of graphs that define this prototype's interior.
 * @property {boolean} isSpecificityChainNode - Whether this node participates in a specificity chain.
 * @property {boolean} hasSpecificityChain - Whether this node is the root of a specificity chain.
 * @property {Object|null} agentConfig - Agent configuration, or null if not an agent node.
 * @property {Object} [semanticMetadata] - Wikipedia/Wikidata enrichment metadata.
 * @property {boolean} [autoEnriched] - True if this prototype was auto-enriched from semantic web.
 */

/**
 * @typedef {Object} NodeInstance
 * @property {string} id - UUID.
 * @property {string} prototypeId - ID of the NodePrototype this instance renders.
 * @property {number} x - Canvas x-coordinate.
 * @property {number} y - Canvas y-coordinate.
 * @property {number} [scale=1] - Scale multiplier relative to base node size.
 */

/**
 * @typedef {Object} GraphData
 * @property {string} id - UUID.
 * @property {string} name - Display name.
 * @property {string} [description] - Description text.
 * @property {boolean} directed - Whether edges in this graph are directed.
 * @property {Map<string, NodeInstance>} instances - Node instances keyed by instance ID.
 * @property {Map<string, Object>} groups - Visual groupings of instances, keyed by group ID.
 * @property {string[]} edgeIds - IDs of edges whose source/destination instances are in this graph.
 * @property {string[]} definingNodeIds - Prototype IDs that "own" this graph as a definition.
 * @property {string|null} color - Optional color inherited from the owning prototype.
 */

/**
 * @typedef {Object} EdgeData
 * @property {string} id - UUID.
 * @property {string} sourceInstanceId - ID of the source NodeInstance.
 * @property {string} destinationInstanceId - ID of the destination NodeInstance.
 * @property {string} graphId - ID of the graph this edge belongs to.
 * @property {string|null} typeNodeId - Prototype ID for the edge type (null = base Connection).
 * @property {string} [name] - Optional label for the edge.
 * @property {Object} directionality - `{ arrowsToward: Set<string> }` — node IDs that have an arrow pointing toward them.
 */

/**
 * @typedef {Object} GraphState
 * @property {Map<string, NodePrototype>} nodePrototypes - All node prototype definitions.
 * @property {Map<string, GraphData>} graphs - All graphs keyed by graph ID.
 * @property {Map<string, EdgeData>} edges - All edges keyed by edge ID.
 * @property {Map<string, Object>} edgePrototypes - Edge type prototypes (subtypes of Connection).
 * @property {Set<string>} protectedPrototypeIds - Prototype IDs exempt from orphan cleanup.
 * @property {Map<string, Object>} pendingDeletions - Soft-deleted instances awaiting grace period expiry.
 * @property {string|null} activeGraphId - ID of the graph currently displayed on the canvas.
 * @property {string[]} openGraphIds - Ordered list of graph IDs open as tabs.
 * @property {string|null} activeDefinitionNodeId - Prototype ID whose definition is being viewed.
 * @property {string|null} selectedEdgeId - Single selected edge ID (used for editing).
 * @property {Set<string>} selectedEdgeIds - Set of selected edge IDs for multi-select.
 * @property {string} typeListMode - Left panel type list state: `'closed'|'node'|'connection'|'component'`.
 * @property {Object[]} rightPanelTabs - Array of tab descriptor objects for the right panel.
 * @property {Set<string>} expandedGraphIds - Graph IDs with their tree item expanded in the panel.
 * @property {Set<string>} savedNodeIds - Prototype IDs pinned to the right panel.
 * @property {Set<string>} savedGraphIds - Graph IDs pinned to the right panel.
 * @property {Object} wizardPlansByConversation - Durable wizard plans keyed by conversation ID.
 * @property {boolean} isUniverseLoaded - True after a universe file has been successfully loaded.
 * @property {boolean} isUniverseLoading - True while a universe file is being loaded.
 * @property {boolean} hasUniverseFile - True if the app is connected to a `.redstring` file.
 * @property {string|null} universeLoadingError - Error message from the last failed load, or null.
 * @property {string} storageMode - `'local'|'git'|'hybrid'` — determines save targets.
 * @property {Object} gitSettings - Git auto-sync preferences: `{ autoSync, defaultRemote, syncOnSave }`.
 * @property {Object|null} gitConnection - Active Git remote connection config, or null.
 * @property {Object|null} gitSyncEngine - Live GitSyncEngine instance, set by UniverseManager.
 * @property {string} gitSourceOfTruth - `'local'|'git'` — which store is authoritative.
 * @property {string} thingNodeId - Always `'base-thing-prototype'`; the root of the type hierarchy.
 * @property {boolean} leftPanelExpanded - Whether the left panel is open.
 * @property {boolean} rightPanelExpanded - Whether the right panel is open.
 * @property {string} inputMode - `'mouse'|'touch'` — current interaction modality (session-only).
 * @property {boolean} darkMode - Dark theme enabled.
 * @property {number} connectionLabelSize - Multiplier for connection label text size.
 * @property {boolean} showConnectionNames - Whether connection labels are visible on the canvas.
 * @property {boolean} showEdgeGlowIndicators - Whether edges show directional glow effects.
 * @property {boolean} showHoverPreview - Whether hovering a node shows a preview card.
 * @property {number} hoverPreviewSize - Scale multiplier for hover preview cards.
 * @property {boolean} showNodeControlPanel - Whether the single-node control panel is visible.
 * @property {boolean} showMultipleNodesControlPanel - Whether the multi-node control panel is visible.
 * @property {boolean} showConnectionControlPanel - Whether the connection control panel is visible.
 * @property {boolean} showGroupControlPanel - Whether the group control panel is visible.
 * @property {boolean} showAbstractionControlPanel - Whether the abstraction chain control panel is visible.
 * @property {Object} gridSettings - `{ mode: 'off'|'hover'|'always', size: number, snapMode: 'if-enabled'|'always'|'never', appearance: 'lattice'|'dot' }`.
 * @property {Object} dragZoomSettings - `{ enabled: boolean, zoomAmount: number }`.
 * @property {Object} autoLayoutSettings - Force-directed layout parameters.
 * @property {Object} forceTunerSettings - Advanced force tuner parameters (mirrors autoLayoutSettings structure).
 * @property {Object} textSettings - `{ fontSize, lineSpacing, nodeScale, connectionWidth, plusSignScale, pieMenuScale }`.
 * @property {Object} keyboardSettings - `{ zoomSensitivity, panSensitivity }` in range [0, 1].
 * @property {Object} mouseSettings - Mouse interaction flags: `{ middleMouseZoomEnabled, nodeDragEdgePanEnabled, connectionDrawEdgePanEnabled, glideEnabled, glideStrength, nodeLiftDelay }`.
 * @property {Object} touchSettings - Touch/trackpad settings: `{ zoomSensitivity, panSensitivity, glideEnabled, glideStrength, trackpadZoomSensitivity, trackpadPanSensitivity }`.
 */

// Enable Immer plugins
enableMapSet();
enablePatches();

const getDefaultAutoLayoutSettings = () => ({
  defaultSpacing: 15,
  nodeClearance: 20,
  enableAutoRouting: true,
  showConnectionLabels: true,
  routingStyle: 'straight',
  manhattanBends: 'auto',
  cleanLaneSpacing: 200,
  // How much parallel (multi) connections bow out. Multiplier on the app-level
  // base curve spacing (200px — the old "2x" look baked in as the 1.0 baseline).
  // Default 1.0. localStorage key bumped to _v2 so stale values saved against the
  // old 100px baseline don't carry over. Persisted in the setter below.
  multiConnectionCurve: (() => {
    try {
      const saved = localStorage.getItem('redstring_multi_connection_curve_v2');
      return saved === null ? 1.0 : parseFloat(saved);
    } catch (_) {
      return 1.0;
    }
  })(),
  layoutScale: 'balanced',
  layoutScaleMultiplier: 1.0,
  layoutIterations: 'balanced',
  groupLayoutAlgorithm: 'node-driven',
  showClusterHulls: false // Debug visualization for connectivity clusters
});

const getDefaultForceTunerSettings = () => ({
  layoutScale: 'balanced',
  layoutScaleMultiplier: 1.0,
  layoutIterations: 'balanced',
  // Individual force parameters
  repulsionStrength: 2200,
  attractionStrength: 0.05,
  linkDistance: 400,
  minLinkDistance: 280,
  centerStrength: 0.015,
  collisionRadius: 90,
  edgeAvoidance: 0.95,
  alphaDecay: 0.008,
  velocityDecay: 0.85
});

const VALID_LAYOUT_SCALE_PRESETS = ['compact', 'balanced', 'spacious'];
const VALID_LAYOUT_ITERATION_PRESETS = ['fast', 'balanced', 'deep'];

// String similarity calculation using Levenshtein distance
const calculateStringSimilarity = (str1, str2) => {
  if (!str1 || !str2) return 0;

  const s1 = str1.toLowerCase().trim();
  const s2 = str2.toLowerCase().trim();

  if (s1 === s2) return 1.0;

  const len1 = s1.length;
  const len2 = s2.length;

  if (len1 === 0 || len2 === 0) return 0;

  // Create matrix
  const matrix = Array(len1 + 1).fill().map(() => Array(len2 + 1).fill(0));

  // Initialize first row and column
  for (let i = 0; i <= len1; i++) matrix[i][0] = i;
  for (let j = 0; j <= len2; j++) matrix[0][j] = j;

  // Fill the matrix
  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,     // deletion
        matrix[i][j - 1] + 1,     // insertion
        matrix[i - 1][j - 1] + cost // substitution
      );
    }
  }

  const distance = matrix[len1][len2];
  const maxLength = Math.max(len1, len2);
  return 1 - (distance / maxLength);
};

const _createAndAssignGraphDefinition = (draft, prototypeId) => {
  const prototype = draft.nodePrototypes.get(prototypeId);
  if (!prototype) {
    console.error(`[Store Helper] Node prototype with ID ${prototypeId} not found.`);
    return null;
  }

  const newGraphId = uuidv4();
  const newGraphName = prototype.name || 'New Thing';

  const newGraphData = {
    id: newGraphId,
    name: newGraphName,
    description: '',
    picture: null,
    color: prototype.color || NODE_DEFAULT_COLOR,
    directed: true,
    instances: new Map(), // Initialize with empty instances map
    groups: new Map(), // Map of groupId to group data
    edgeIds: [],
    definingNodeIds: [prototypeId], // This is the ID of the prototype
  };
  draft.graphs.set(newGraphId, newGraphData);

  if (!Array.isArray(prototype.definitionGraphIds)) {
    prototype.definitionGraphIds = [];
  }
  prototype.definitionGraphIds.push(newGraphId);

  return newGraphId;
};

/**
 * Helper function to normalize edge directionality to ensure arrowsToward is always a Set
 */
const normalizeEdgeDirectionality = (directionality) => {
  if (!directionality || typeof directionality !== 'object') {
    return { arrowsToward: new Set() };
  }

  if (!directionality.arrowsToward) {
    return { arrowsToward: new Set() };
  }

  if (directionality.arrowsToward instanceof Set) {
    return directionality;
  }

  if (Array.isArray(directionality.arrowsToward)) {
    return { arrowsToward: new Set(directionality.arrowsToward) };
  }

  return { arrowsToward: new Set() };
};

// Middleware to integrate with SaveCoordinator
const saveCoordinatorMiddleware = (config) => {
  let saveCoordinator = null;
  let changeContext = { type: 'unknown' };
  let pendingNotification = null;
  let batchedContext = { type: 'unknown' };

  // History batching variables
  let historyTimeout = null;
  let historyBatch = {
    patches: [],
    inversePatches: [],
    descriptions: [],
    domain: null,
    actionTypes: new Set(),
    timestamp: 0
  };

  // Lazy load SaveCoordinator to avoid circular dependencies
  const getSaveCoordinator = async () => {
    if (!saveCoordinator) {
      try {
        const module = await import('../services/SaveCoordinator.js');
        saveCoordinator = module.default;
      } catch (error) {
        console.warn('[GraphStore] SaveCoordinator not available:', error);
      }
    }
    return saveCoordinator;
  };

  // In-memory data-collapse tripwire. Snapshots data sizes before/after each
  // `set()` and logs a stack trace if user data has catastrophically shrunk
  // (e.g. nodes went from 50 to 0). Catches surprise resets, broken HMR
  // restores, or any code path that silently wipes the store. Lets the user
  // see WHO cleared the state instead of just discovering an empty file later.
  const countUserData = (state) => {
    if (!state) return { nodes: 0, graphs: 0 };
    let nodes = 0;
    if (state.nodePrototypes instanceof Map) {
      for (const id of state.nodePrototypes.keys()) {
        if (id !== 'base-thing-prototype' && id !== 'base-connection-prototype') nodes++;
      }
    }
    const graphs = state.graphs instanceof Map ? state.graphs.size : 0;
    return { nodes, graphs };
  };

  return (set, get, api) => {
    // Enhance the set function to track change context and capture patches
    const enhancedSet = (...args) => {
      // 0. Snapshot for collapse detection
      let preCounts = null;
      try { preCounts = countUserData(get()); } catch (_) { /* non-fatal */ }

      // 1. Capture patches via the global listener (hooked into our custom produce wrapper)
      let currentPatches = null;
      let currentInverse = null;
      patchListener = (p, i) => {
        currentPatches = p;
        currentInverse = i;
      };

      // 2. Execute the state update
      set(...args);

      // 2a. Collapse detection. We allow load and reset contexts to legitimately
      // wipe state. Anything else getting flagged is suspicious — print a stack
      // trace so the offending code path is identifiable.
      try {
        if (preCounts) {
          const postCounts = countUserData(get());
          const ctxType = changeContext?.type || 'unknown';
          const allowedToWipe = ctxType === 'load' || ctxType === 'reset' || ctxType === 'clear-universe';
          const collapsed = !allowedToWipe && (
            (preCounts.nodes >= 5 && postCounts.nodes <= Math.max(2, Math.floor(preCounts.nodes * 0.1))) ||
            (preCounts.graphs >= 1 && postCounts.graphs === 0)
          );
          if (collapsed) {
            console.error(
              '[graphStore] ⚠ DATA COLLAPSE detected in set()',
              { before: preCounts, after: postCounts, changeContext },
              new Error('stack-trace-for-collapse').stack
            );
          }
        }
      } catch (_) { /* non-fatal — never let the tripwire itself break the store */ }

      // 3. Initialize cleanup and reset listener immediately
      patchListener = null;

      // --- History Recording (Batched) ---
      const recordableTypes = new Set([
        'node_place', 'node_delete', 'node_delete_batch', 'node_type_change', 'node_update',
        'edge_create', 'edge_delete', 'edge_update', 'edge_type_change',
        'group_create', 'group_update', 'group_delete', 'group_convert', 'group_combine',
        'prototype_create', 'prototype_update', 'prototype_delete',
        'position_update', 'node_position',
        'graph_create', 'graph_delete', 'graph_update',
        'paste', 'bulk_update'
      ]);

      if (changeContext.ignore) {
        // Explicitly skip recording
      } else if (recordableTypes.has(changeContext.type)) {
        // Special handling for position updates: only record if finalized (drag end)
        if ((changeContext.type === 'node_position' || changeContext.type === 'position_update') && !changeContext.finalize) {
          // Skip recording intermediate drag states
        } else {
          // Determine domain
          const isGlobal = changeContext.type.startsWith('prototype_') ||
            changeContext.type.startsWith('graph_');

          const domain = isGlobal
            ? 'global'
            : `graph-${changeContext.graphId || get().activeGraphId}`; // Fallback to active graph

          // Accumulate into batch if patches exist
          if (currentPatches && currentPatches.length > 0) {
            // Check if we should flush previous batch due to major context switch (e.g. domain change or actionId change)
            const isDifferentAction = changeContext.actionId && historyBatch.actionId && changeContext.actionId !== historyBatch.actionId;
            if (historyBatch.patches.length > 0 && (historyBatch.domain !== domain || isDifferentAction)) {
              // Flush immediately
              flushHistoryBatch();
            }

            if (historyBatch.patches.length === 0) {
              historyBatch.domain = domain;
              historyBatch.timestamp = Date.now();
            }

            historyBatch.patches.push(...currentPatches);
            // Inverse patches prepend: (Revert New, then Revert Old)
            historyBatch.inversePatches.unshift(...currentInverse);

            const desc = generateDescription(changeContext, get());
            historyBatch.descriptions.push(desc);
            historyBatch.actionTypes.add(changeContext.type);

            if (changeContext.actionId) historyBatch.actionId = changeContext.actionId;
            if (changeContext.isWizard) historyBatch.isWizard = changeContext.isWizard;

            // Debounce flush
            if (historyTimeout) clearTimeout(historyTimeout);
            historyTimeout = setTimeout(flushHistoryBatch, 50); // 50ms batch window
          }
        }
      }

      // Helper to flush batch
      function flushHistoryBatch() {
        if (!historyBatch.patches.length) return;

        // Generate combined description
        let finalDescription = historyBatch.descriptions[0];
        if (historyBatch.descriptions.length > 1) {
          // Check for homogenous batch
          const uniqueTypes = historyBatch.actionTypes;
          if (uniqueTypes.has('edge_update') && uniqueTypes.size > 1) {
            // E.g. Update Node + Update Edge(s)
            finalDescription = `${historyBatch.descriptions[0]} (+ related updates)`;
          } else if (historyBatch.descriptions.length > 3) {
            finalDescription = `${historyBatch.descriptions[0]} (+ ${historyBatch.descriptions.length - 1} actions)`;
          } else {
            // Join distinct descriptions if few
            const uniqueDescs = [...new Set(historyBatch.descriptions)];
            finalDescription = uniqueDescs.join(', ');
          }
        }

        useHistoryStore.getState().pushAction({
          domain: historyBatch.domain,
          actionType: Array.from(historyBatch.actionTypes).join('+'), // 'node_update+edge_update'
          description: finalDescription,
          patches: [...historyBatch.patches],
          inversePatches: [...historyBatch.inversePatches],
          timestamp: historyBatch.timestamp,
          actionId: historyBatch.actionId,
          isWizard: historyBatch.isWizard
        });

        // Reset
        historyBatch = {
          patches: [],
          inversePatches: [],
          descriptions: [],
          domain: null,
          actionTypes: new Set(),
          timestamp: 0,
          actionId: null,
          isWizard: false
        };
        historyTimeout = null;
      }

      // Batch multiple rapid state changes into a single notification (Send to SaveCoordinator)
      if (pendingNotification) {
        clearTimeout(pendingNotification);
      }

      const isMeaningfulType = (t) => t && t !== 'viewport' && t !== 'unknown';
      batchedContext = {
        ...batchedContext,
        ...changeContext,
        type: isMeaningfulType(batchedContext.type) && !isMeaningfulType(changeContext.type)
          ? batchedContext.type
          : changeContext.type,
      };

      pendingNotification = setTimeout(async () => {
        try {
          const coordinator = await getSaveCoordinator();
          if (coordinator && coordinator.isEnabled) {
            const currentState = get();
            coordinator.onStateChange(currentState, batchedContext);
          }

          changeContext = { type: 'unknown' };
          batchedContext = { type: 'unknown' };
          pendingNotification = null;
        } catch (error) {
          console.warn('[GraphStore] SaveCoordinator notification failed:', error);
        }
      }, 0);
    };

    // Add change context setter to the store
    const configWithContext = config(enhancedSet, get, {
      ...api,
      // Helper to set context for the next state change
      setChangeContext: (context) => {
        changeContext = { ...changeContext, ...context };
      }
    });

    // Return config with context helper exposed
    return {
      ...configWithContext,
      setChangeContext: (context) => {
        changeContext = { ...changeContext, ...context };
      }
    };
  };
};

// Create store with async initialization
const useGraphStore = create(saveCoordinatorMiddleware((set, get, api) => {
  // Grace period cleanup timer
  let cleanupTimer = null;

  const startCleanupTimer = () => {
    if (cleanupTimer) clearInterval(cleanupTimer);
    // Run cleanup every minute
    cleanupTimer = setInterval(() => {
      const state = get();
      if (state.pendingDeletions.size > 0) {
        state.cleanupExpiredDeletions();
      }
    }, 60 * 1000); // 1 minute intervals
  };

  const stopCleanupTimer = () => {
    if (cleanupTimer) {
      clearInterval(cleanupTimer);
      cleanupTimer = null;
    }
  };

  // Start the timer initially
  startCleanupTimer();

  // Return both initial state and actions
  return {
    // Initialize with completely empty state - universe file is required
    graphs: new Map(),
    // Prototypes explicitly protected from cleanup (e.g., local Orbit catalog)
    protectedPrototypeIds: new Set(),
    nodePrototypes: (() => {
      // Initialize with base "Thing" and "Connection" types
      const nodePrototypes = new Map();

      // Base "Thing" type
      const thingId = 'base-thing-prototype';
      nodePrototypes.set(thingId, {
        id: thingId,
        name: 'Thing',
        description: 'The base type for all things. Things are nodes, ideas, nouns, concepts, objects, whatever you want them to be. They will always be at the bottom of the abstraction stack. They are the "atoms" of your Redstring universe.',
        color: '#8B0000', // Dark red/maroon
        typeNodeId: null, // No parent type - this is the most basic type
        definitionGraphIds: [],
        isSpecificityChainNode: false, // Not part of any specificity chain
        hasSpecificityChain: false, // Does not define a specificity chain
        agentConfig: null // Agent configuration (null = not an agent)
      });

      // Base "Connection" type
      const connectionId = 'base-connection-prototype';
      nodePrototypes.set(connectionId, {
        id: connectionId,
        name: 'Connection',
        description: 'The base type for all connections. Connections are edges, relationships, verbs, actions, whatever you want them to be. They will always be at the bottom of the connection abstraction stack.',
        color: '#000000', // Black
        typeNodeId: null, // No parent type - this is the most basic connection type
        definitionGraphIds: [],
        isSpecificityChainNode: false, // Not part of any specificity chain
        hasSpecificityChain: false, // Does not define a specificity chain
        agentConfig: null // Agent configuration (null = not an agent)
      });

      return nodePrototypes;
    })(),
    edgePrototypes: (() => {
      // Initialize with base "Connection" type
      const connectionId = 'base-connection-prototype';
      const edgePrototypes = new Map();
      edgePrototypes.set(connectionId, {
        id: connectionId,
        name: 'Connection',
        description: 'The base type for all connections. Connections are edges, relationships, verbs, actions, whatever you want them to be. They will always be at the bottom of the connection abstraction stack.',
        color: '#000000', // Black
        typeNodeId: null, // No parent type - this is the most basic connection type
        definitionGraphIds: [],
        isSpecificityChainNode: false, // Not part of any specificity chain
        hasSpecificityChain: false // Does not define a specificity chain
      });

      // Agent control flow edge types (for agent graphs)
      const agentEdgeTypes = [
        { id: 'agent-delegates-to', name: 'Delegates To', color: '#E74C3C', description: 'Parent assigns subtask to child agent' },
        { id: 'agent-reports-to', name: 'Reports To', color: '#2ECC71', description: 'Child returns results to parent agent' },
        { id: 'agent-triggers', name: 'Triggers', color: '#F39C12', description: 'Event causes agent to fire' },
        { id: 'agent-validates', name: 'Validates', color: '#9B59B6', description: 'Checks output of another agent' },
        { id: 'agent-fallback-to', name: 'Fallback To', color: '#1ABC9C', description: 'If primary fails, try this agent' },
        { id: 'agent-depends-on', name: 'Depends On', color: '#3498DB', description: 'Must wait for completion' }
      ];

      agentEdgeTypes.forEach(edgeType => {
        edgePrototypes.set(edgeType.id, {
          id: edgeType.id,
          name: edgeType.name,
          description: edgeType.description,
          color: edgeType.color,
          typeNodeId: connectionId, // All agent edges are subtypes of Connection
          definitionGraphIds: [],
          isSpecificityChainNode: false,
          hasSpecificityChain: false
        });
      });

      return edgePrototypes;
    })(),
    edges: new Map(),

    // Grace period tracking for soft deletion
    pendingDeletions: new Map(), // instanceId -> { timestamp, graphId, instanceData }
    gracePeriodMs: 5 * 60 * 1000, // 5 minutes in milliseconds

    openGraphIds: [],
    activeGraphId: null,
    activeDefinitionNodeId: null, // This now refers to a prototypeId
    selectedEdgeId: null, // Currently selected edge for editing
    selectedEdgeIds: new Set(), // Multiple selected edges
    typeListMode: (() => {
      // Load saved state from localStorage, with 'connection' as default
      const savedMode = localStorage.getItem('redstring_typelist_mode');
      if (savedMode && ['closed', 'node', 'connection', 'component'].includes(savedMode)) {
        return savedMode;
      } else {
        return 'connection'; // Default order: connections -> nodes -> closed
      }
    })(),
    rightPanelTabs: [{ type: 'home', isActive: true }],
    expandedGraphIds: new Set(),
    savedNodeIds: new Set(), // This now refers to prototype IDs
    savedGraphIds: new Set(), // This is based on the defining prototype ID

    // Durable wizard plans keyed by conversation/tab ID — persists across LLM context clears
    wizardPlansByConversation: {},  // { [conversationId]: { steps, graphId } }

    // Universe file state
    isUniverseLoaded: false,
    isUniverseLoading: true, // Start in loading state
    universeLoadingError: null,
    hasUniverseFile: false,
    _isLoadingUniverse: false, // Internal lock to prevent concurrent loads
    _universeSlug: null, // Identity stamp: which universe this state belongs to

    // Storage mode settings
    storageMode: 'hybrid', // 'local', 'git', 'hybrid'
    gitSettings: {
      autoSync: false,
      defaultRemote: 'origin',
      syncOnSave: true
    },

    // Thing node ID for abstraction system
    thingNodeId: 'base-thing-prototype',

    // UI Settings
    connectionLabelSize: (() => {
      try {
        const saved = localStorage.getItem('redstring_connection_label_size');
        return saved === null ? 1.0 : parseFloat(saved);
      } catch (_) {
        return 1.0;
      }
    })(),
    showConnectionNames: (() => {
      try {
        const saved = localStorage.getItem('redstring_show_connection_names');
        return saved === null ? true : saved === 'true';
      } catch (_) {
        return true;
      }
    })(),
    showEdgeGlowIndicators: (() => {
      try {
        const saved = localStorage.getItem('redstring_show_edge_glow');
        return saved === null ? true : saved === 'true';
      } catch (_) {
        return true;
      }
    })(),
    darkMode: (() => {
      try {
        const saved = localStorage.getItem('redstring_dark_mode');
        return saved === 'true';
      } catch (_) {
        return false;
      }
    })(),
    showHoverPreview: (() => {
      try {
        const saved = localStorage.getItem('redstring_show_hover_preview');
        return saved === null ? true : saved === 'true';
      } catch (_) {
        return true;
      }
    })(),
    showNodeControlPanel: (() => { try { const s = localStorage.getItem('redstring_show_node_cp'); return s === null ? false : s === 'true'; } catch (_) { return false; } })(),
    showMultipleNodesControlPanel: (() => { try { const s = localStorage.getItem('redstring_show_multi_node_cp'); return s === null ? true : s === 'true'; } catch (_) { return true; } })(),
    showConnectionControlPanel: (() => { try { const s = localStorage.getItem('redstring_show_connection_cp'); return s === null ? true : s === 'true'; } catch (_) { return true; } })(),
    showGroupControlPanel: (() => { try { const s = localStorage.getItem('redstring_show_group_cp'); return s === null ? true : s === 'true'; } catch (_) { return true; } })(),
    showAbstractionControlPanel: (() => { try { const s = localStorage.getItem('redstring_show_abstraction_cp'); return s === null ? true : s === 'true'; } catch (_) { return true; } })(),
    hoverPreviewSize: (() => {
      try {
        const saved = localStorage.getItem('redstring_hover_preview_size');
        const v = saved === null ? 1.0 : parseFloat(saved);
        return Number.isFinite(v) ? v : 1.0;
      } catch (_) {
        return 1.0;
      }
    })(),
    // Grid visualization settings
    gridSettings: (() => {
      try {
        const modeRaw = localStorage.getItem('redstring_grid_mode');
        const sizeRaw = localStorage.getItem('redstring_grid_size');
        const snapRaw = localStorage.getItem('redstring_grid_snap');
        const appearanceRaw = localStorage.getItem('redstring_grid_appearance');
        const allowed = new Set(['off', 'hover', 'always']);
        const snapAllowed = new Set(['if-enabled', 'always', 'never']);
        const appearanceAllowed = new Set(['lattice', 'dot']);
        const mode = allowed.has(modeRaw) ? modeRaw : 'off';
        const snapMode = snapAllowed.has(snapRaw) ? snapRaw : 'if-enabled';
        const appearance = appearanceAllowed.has(appearanceRaw) ? appearanceRaw : 'lattice';
        let size = Number.parseInt(sizeRaw, 10);
        if (!Number.isFinite(size)) size = 200;
        size = Math.max(20, Math.min(400, Math.round(size)));
        return { mode, size, snapMode, appearance };
      } catch (_) {
        return { mode: 'off', size: 200, snapMode: 'if-enabled', appearance: 'lattice' };
      }
    })(),
    // Drag zoom settings
    dragZoomSettings: (() => {
      try {
        const enabledRaw = localStorage.getItem('redstring_drag_zoom_enabled');
        const amountRaw = localStorage.getItem('redstring_drag_zoom_amount');
        const enabled = enabledRaw ? enabledRaw === 'true' : true;
        let amount = parseFloat(amountRaw);
        if (!Number.isFinite(amount)) amount = 0.45;
        amount = Math.max(0.0, Math.min(0.9, amount));
        return { enabled, zoomAmount: amount };
      } catch (_) {
        return { enabled: true, zoomAmount: 0.45 };
      }
    })(),
    // Connections visualization/layout settings
    autoLayoutSettings: getDefaultAutoLayoutSettings(),
    forceTunerSettings: getDefaultForceTunerSettings(),
    // Text appearance settings
    textSettings: (() => {
      try {
        return {
          fontSize: parseFloat(localStorage.getItem('redstring_text_font_size')) || 1.0,
          lineSpacing: parseFloat(localStorage.getItem('redstring_text_line_spacing')) || 1.0,
          nodeScale: parseFloat(localStorage.getItem('redstring_node_scale')) || 1.0,
          connectionWidth: parseFloat(localStorage.getItem('redstring_connection_width')) || 1.0,
          plusSignScale: parseFloat(localStorage.getItem('redstring_plus_sign_scale')) || 1.0,
          pieMenuScale: parseFloat(localStorage.getItem('redstring_pie_menu_scale')) || 1.0,
        };
      } catch (_) {
        return { fontSize: 1.0, lineSpacing: 1.0, nodeScale: 1.0, connectionWidth: 1.0, plusSignScale: 1.0, pieMenuScale: 1.0 };
      }
    })(),

    // Keyboard and interaction settings
    keyboardSettings: (() => {
      try {
        const zoomSensitivityRaw = localStorage.getItem('redstring_keyboard_zoom_sensitivity');
        const panSensitivityRaw = localStorage.getItem('redstring_keyboard_pan_sensitivity');

        let zoomSensitivity = zoomSensitivityRaw !== null ? parseFloat(zoomSensitivityRaw) : 0.5;
        if (!Number.isFinite(zoomSensitivity)) zoomSensitivity = 0.5;
        zoomSensitivity = Math.max(0.0, Math.min(1.0, zoomSensitivity));

        let panSensitivity = panSensitivityRaw !== null ? parseFloat(panSensitivityRaw) : 0.5;
        if (!Number.isFinite(panSensitivity)) panSensitivity = 0.5;
        panSensitivity = Math.max(0.0, Math.min(1.0, panSensitivity));

        return { zoomSensitivity, panSensitivity };
      } catch (_) {
        return { zoomSensitivity: 0.5, panSensitivity: 0.5 };
      }
    })(),

    // Mouse / pointer interaction settings (apply to mouse + touch where relevant)
    mouseSettings: (() => {
      try {
        const middleRaw = localStorage.getItem('redstring_middle_mouse_zoom_enabled');
        const middleMouseZoomEnabled = middleRaw === 'true';
        const ndepRaw = localStorage.getItem('redstring_node_drag_edge_pan_enabled');
        const nodeDragEdgePanEnabled = ndepRaw === null ? true : ndepRaw === 'true';
        const cdepRaw = localStorage.getItem('redstring_connection_draw_edge_pan_enabled');
        const connectionDrawEdgePanEnabled = cdepRaw === null ? true : cdepRaw === 'true';
        const glideRaw = localStorage.getItem('redstring_mouse_glide_enabled');
        const glideEnabled = glideRaw === null ? true : glideRaw === 'true';
        const glideStrengthRaw = localStorage.getItem('redstring_mouse_glide_strength');
        let glideStrength = glideStrengthRaw !== null ? parseFloat(glideStrengthRaw) : 0.1;
        if (!Number.isFinite(glideStrength)) glideStrength = 0.1;
        glideStrength = Math.max(0.0, Math.min(1.0, glideStrength));
        const liftDelayRaw = localStorage.getItem('redstring_node_lift_delay');
        let nodeLiftDelay = liftDelayRaw !== null ? parseFloat(liftDelayRaw) : 250;
        if (!Number.isFinite(nodeLiftDelay)) nodeLiftDelay = 250;
        nodeLiftDelay = Math.max(50, Math.min(1000, nodeLiftDelay));
        return { middleMouseZoomEnabled, nodeDragEdgePanEnabled, connectionDrawEdgePanEnabled, glideEnabled, glideStrength, nodeLiftDelay };
      } catch (_) {
        return { middleMouseZoomEnabled: false, nodeDragEdgePanEnabled: true, connectionDrawEdgePanEnabled: true, glideEnabled: true, glideStrength: 0.1, nodeLiftDelay: 250 };
      }
    })(),

    // Active input modality — flipped per-interaction by pointerdown listener.
    // 'mouse' enables hover affordances; 'touch' forces always-visible affordances
    // (e.g. connection arrow dots) and suppresses hover previews. Session-only,
    // not persisted: each pointerdown re-evaluates via PointerEvent.pointerType.
    inputMode: 'mouse',

    // Touch interaction settings — sliders in [0, 1], 0.5 maps to the
    // current "good default" multiplier in the touch input layer.
    touchSettings: (() => {
      try {
        const zoomRaw = localStorage.getItem('redstring_touch_zoom_sensitivity');
        const panRaw = localStorage.getItem('redstring_touch_pan_sensitivity');

        let zoomSensitivity = zoomRaw !== null ? parseFloat(zoomRaw) : 0.7;
        if (!Number.isFinite(zoomSensitivity)) zoomSensitivity = 0.7;
        zoomSensitivity = Math.max(0.0, Math.min(1.0, zoomSensitivity));

        let panSensitivity = panRaw !== null ? parseFloat(panRaw) : 0.5;
        if (!Number.isFinite(panSensitivity)) panSensitivity = 0.5;
        panSensitivity = Math.max(0.0, Math.min(1.0, panSensitivity));

        const glideRaw = localStorage.getItem('redstring_touch_glide_enabled');
        const glideEnabled = glideRaw === null ? true : glideRaw === 'true';

        const glideStrengthRaw = localStorage.getItem('redstring_touch_glide_strength');
        let glideStrength = glideStrengthRaw !== null ? parseFloat(glideStrengthRaw) : 0.5;
        if (!Number.isFinite(glideStrength)) glideStrength = 0.5;
        glideStrength = Math.max(0.0, Math.min(1.0, glideStrength));

        const trackpadZoomRaw = localStorage.getItem('redstring_trackpad_zoom_sensitivity');
        let trackpadZoomSensitivity = trackpadZoomRaw !== null ? parseFloat(trackpadZoomRaw) : 0.5;
        if (!Number.isFinite(trackpadZoomSensitivity)) trackpadZoomSensitivity = 0.5;
        trackpadZoomSensitivity = Math.max(0.1, Math.min(1.0, trackpadZoomSensitivity));

        const trackpadPanRaw = localStorage.getItem('redstring_trackpad_pan_sensitivity');
        let trackpadPanSensitivity = trackpadPanRaw !== null ? parseFloat(trackpadPanRaw) : 0.5;
        if (!Number.isFinite(trackpadPanSensitivity)) trackpadPanSensitivity = 0.5;
        trackpadPanSensitivity = Math.max(0.1, Math.min(1.0, trackpadPanSensitivity));

        return { zoomSensitivity, panSensitivity, glideEnabled, glideStrength, trackpadZoomSensitivity, trackpadPanSensitivity };
      } catch (_) {
        return { zoomSensitivity: 0.7, panSensitivity: 0.5, glideEnabled: true, glideStrength: 0.5, trackpadZoomSensitivity: 0.5, trackpadPanSensitivity: 0.5 };
      }
    })(),

    // Git Federation State
    gitConnection: (() => {
      // Load saved connection from localStorage
      const saved = localStorage.getItem('redstring_git_connection');
      if (saved) {
        try {
          return JSON.parse(saved);
        } catch (e) {
          console.warn('[GraphStore] Failed to parse saved Git connection:', e);
        }
      }
      return null;
    })(),
    gitSyncEngine: null, // Will be set by UniverseManager component
    gitSourceOfTruth: (() => {
      // Load saved source of truth from localStorage
      const saved = localStorage.getItem('redstring_git_source_of_truth');
      return saved === 'git' ? 'git' : 'local'; // Default to 'local'
    })(),

    // Panel State
    leftPanelExpanded: false,
    rightPanelExpanded: false,
    // Force UI mapping
    _triggerGraphRefresh: () => set((state) => ({ _refreshTick: (state._refreshTick || 0) + 1 })),

    // --- Actions --- (Operating on plain data)

    // ─── PANEL LAYOUT ────────────────────────────────────────────────────────────
    /**
     * Sets whether the left panel is expanded.
     * @param {boolean} expanded
     */
    setLeftPanelExpanded: (expanded) => set({ leftPanelExpanded: expanded }),
    /** @param {boolean} expanded */
    setRightPanelExpanded: (expanded) => set({ rightPanelExpanded: expanded }),
    /** Toggles the left panel open/closed. */
    toggleLeftPanel: () => set(state => ({ leftPanelExpanded: !state.leftPanelExpanded })),
    /** Toggles the right panel open/closed. */
    toggleRightPanel: () => set(state => ({ rightPanelExpanded: !state.rightPanelExpanded })),

    // ─── GROUP MANAGEMENT ────────────────────────────────────────────────────────

    /**
     * Creates a new visual group within a graph, optionally pre-populated with member instances.
     *
     * Groups are visual clusters of node instances. They store semantic metadata for RDF
     * relationship tracking. Returns the new group ID.
     *
     * @param {string} graphId - ID of the graph to create the group in.
     * @param {Object} [options]
     * @param {string} [options.name='Group'] - Display name for the group.
     * @param {string} [options.color='#8B0000'] - Hex color for the group border.
     * @param {string[]} [options.memberInstanceIds=[]] - Instance IDs to include as initial members.
     * @param {Object} [contextOptions] - Save context flags (isDragging, phase, etc.).
     * @returns {string|null} The new group ID, or null if the graph was not found.
     */
    createGroup: (graphId, { name = 'Group', color = '#8B0000', memberInstanceIds = [] } = {}, contextOptions = {}) => {
      api.setChangeContext({ type: 'group_create', target: 'group', ...contextOptions });
      let createdGroupId = null;
      set(produce((draft) => {
        const graph = draft.graphs.get(graphId);
        if (!graph) {
          console.warn(`[createGroup] Graph ${graphId} not found.`);
          return;
        }
        if (!graph.groups) graph.groups = new Map();
        const id = uuidv4();

        // Create group with semantic metadata for RDF/OWL integration
        const groupData = {
          id,
          name,
          color,
          memberInstanceIds: Array.from(new Set(memberInstanceIds)),
          semanticMetadata: {
            type: 'Group',
            relationships: memberInstanceIds.map(memberId => ({
              predicate: 'memberOf',
              subject: memberId,
              object: id,
              source: 'redstring-grouping'
            })),
            createdAt: new Date().toISOString(),
            lastModified: new Date().toISOString()
          }
        };

        graph.groups.set(id, groupData);
        createdGroupId = id;
      }));
      return createdGroupId;
    },

    /**
     * Applies an Immer recipe function to a group, mutating it in place.
     *
     * Automatically updates `semanticMetadata.lastModified` and syncs the RDF
     * relationship list when membership changes.
     *
     * @param {string} graphId - ID of the graph containing the group.
     * @param {string} groupId - ID of the group to update.
     * @param {function} recipe - Immer recipe: `(group) => { group.name = '...'; }`.
     * @param {Object} [contextOptions] - Save context flags.
     */
    updateGroup: (graphId, groupId, recipe, contextOptions = {}) => {
      api.setChangeContext({ type: 'group_update', target: 'group', groupId, ...contextOptions });
      return set(produce((draft) => {
        const graph = draft.graphs.get(graphId);
        if (!graph?.groups) return;
        const group = graph.groups.get(groupId);
        if (!group) return;

        // Store original values for change tracking
        const originalName = group.name;
        const originalMemberIds = [...group.memberInstanceIds];

        recipe(group);

        // Update semantic metadata on changes
        if (!group.semanticMetadata) {
          group.semanticMetadata = {
            type: 'Group',
            relationships: [],
            createdAt: new Date().toISOString(),
            lastModified: new Date().toISOString()
          };
        }

        // Update relationships if membership changed
        if (JSON.stringify(originalMemberIds) !== JSON.stringify(group.memberInstanceIds)) {
          group.semanticMetadata.relationships = group.memberInstanceIds.map(memberId => ({
            predicate: 'memberOf',
            subject: memberId,
            object: groupId,
            source: 'redstring-grouping'
          }));
        }

        // Update lastModified timestamp
        group.semanticMetadata.lastModified = new Date().toISOString();

        // Log changes for semantic integration
        if (originalName !== group.name) {
          console.log(`[updateGroup] Group ${groupId} renamed from "${originalName}" to "${group.name}"`);

          // If this is a node-group, sync the name change to the linked prototype
          if (group.linkedNodePrototypeId) {
            const prototype = draft.nodePrototypes.get(group.linkedNodePrototypeId);
            if (prototype) {
              const prototypeOriginalName = prototype.name;
              prototype.name = group.name;
              console.log(`[updateGroup] Syncing node-group name to prototype ${group.linkedNodePrototypeId}: "${prototypeOriginalName}" → "${group.name}"`);

              // Sync name change to any graphs defined by this prototype (matching updateNodePrototype logic)
              if (Array.isArray(prototype.definitionGraphIds)) {
                prototype.definitionGraphIds.forEach(defGraphId => {
                  const defGraph = draft.graphs.get(defGraphId);
                  if (defGraph) {
                    defGraph.name = group.name;
                  }
                });
              }

              // Update titles in right panel tabs
              draft.rightPanelTabs.forEach(tab => {
                if (tab.nodeId === group.linkedNodePrototypeId) {
                  tab.title = group.name;
                }
              });
            } else {
              console.warn(`[updateGroup] Node-group ${groupId} references non-existent prototype ${group.linkedNodePrototypeId}`);
            }
          }
        }
      }));
    },

    /**
     * Removes a group from a graph, restoring all member instances to ungrouped state.
     *
     * Clears `isGroupAnchor` and `anchorForGroupId` flags from the anchor instance.
     *
     * @param {string} graphId - ID of the graph containing the group.
     * @param {string} groupId - ID of the group to delete.
     * @param {Object} [contextOptions] - Save context flags.
     */
    deleteGroup: (graphId, groupId, contextOptions = {}) => {
      api.setChangeContext({ type: 'group_delete', target: 'group', ...contextOptions });
      return set(produce((draft) => {
        const graph = draft.graphs.get(graphId);
        if (!graph?.groups) return;
        const group = graph.groups.get(groupId);
        if (!group) return;

        // Clean up anchor instance and its edges (thing groups only)
        if (group.anchorInstanceId && graph.instances?.has(group.anchorInstanceId)) {
          const anchorId = group.anchorInstanceId;
          // Remove edges connected to the anchor
          const edgesToRemove = [];
          draft.edges.forEach((edge, edgeId) => {
            if (edge.sourceId === anchorId || edge.destinationId === anchorId) {
              edgesToRemove.push(edgeId);
            }
          });
          edgesToRemove.forEach(edgeId => {
            draft.edges.delete(edgeId);
            if (graph.edgeIds) {
              const idx = graph.edgeIds.indexOf(edgeId);
              if (idx > -1) graph.edgeIds.splice(idx, 1);
            }
          });
          graph.instances.delete(anchorId);
        }

        graph.groups.delete(groupId);
      }));
    },

    /**
     * Ensures a group has a valid anchor instance, creating one or reassigning as needed.
     *
     * An anchor instance is the group's "representative" node on the canvas — it remains
     * visible when the group is collapsed. If `preferredAnchorInstanceId` is provided
     * and belongs to the group, it is promoted; otherwise the first member is used.
     *
     * @param {string} graphId - ID of the graph containing the group.
     * @param {string} groupId - ID of the group to anchor.
     * @param {Object} [options]
     * @param {string} [options.preferredAnchorInstanceId] - Instance ID to prefer as anchor.
     * @param {Object} [options] - Remaining keys are passed as contextOptions.
     */
    ensureGroupAnchor: (graphId, groupId, { preferredAnchorInstanceId, ...contextOptions } = {}) => {
      api.setChangeContext({ type: 'group_anchor_repair', target: 'group', groupId, ...contextOptions });
      let anchorId = null;
      set(produce((draft) => {
        const graph = draft.graphs.get(graphId);
        if (!graph?.groups) return;
        const group = graph.groups.get(groupId);
        if (!group) return;
        // Only node-groups (linked to a prototype) get an anchor.
        if (!group.linkedNodePrototypeId) return;
        // Already has a valid anchor instance? Nothing to do (keeps this idempotent).
        if (group.anchorInstanceId && graph.instances?.has(group.anchorInstanceId)) {
          anchorId = group.anchorInstanceId;
          return;
        }
        const prototype = draft.nodePrototypes.get(group.linkedNodePrototypeId);
        if (!prototype) {
          console.warn(`[ensureGroupAnchor] Prototype ${group.linkedNodePrototypeId} not found for group ${groupId}.`);
          return;
        }
        if (!graph.instances) graph.instances = new Map();

        // Adopt an existing instance as the anchor when asked (node→node-group conversion
        // reuses the original node so its edges survive instead of being deleted with it).
        const preferred = preferredAnchorInstanceId ? graph.instances.get(preferredAnchorInstanceId) : null;
        if (preferred && preferred.prototypeId === group.linkedNodePrototypeId) {
          preferred.isGroupAnchor = true;
          preferred.anchorForGroupId = groupId;
          group.anchorInstanceId = preferredAnchorInstanceId;
          anchorId = preferredAnchorInstanceId;
          console.log(`[ensureGroupAnchor] Adopted instance ${anchorId} as anchor for node-group ${groupId}.`);
          return;
        }

        // Position the anchor at the member centroid (fall back to the group's own coords).
        let anchorX = group.x ?? 0, anchorY = group.y ?? 0;
        const memberInstances = (group.memberInstanceIds || [])
          .map(id => graph.instances.get(id))
          .filter(Boolean);
        if (memberInstances.length > 0) {
          const totals = memberInstances.reduce((acc, inst) => {
            acc.x += inst.x ?? 0;
            acc.y += inst.y ?? 0;
            return acc;
          }, { x: 0, y: 0 });
          anchorX = totals.x / memberInstances.length;
          anchorY = totals.y / memberInstances.length;
        }

        anchorId = uuidv4();
        graph.instances.set(anchorId, {
          id: anchorId,
          prototypeId: group.linkedNodePrototypeId,
          x: anchorX,
          y: anchorY,
          scale: 1,
          isGroupAnchor: true,
          anchorForGroupId: groupId
        });
        group.anchorInstanceId = anchorId;
        console.log(`[ensureGroupAnchor] Created anchor ${anchorId} for node-group ${groupId}.`);
      }));
      return anchorId;
    },

    /**
     * Converts a plain group into a node-group: associates it with a node prototype so the
     * group renders as a "thing" with an expandable interior.
     *
     * If `createNewPrototype` is true, creates a new prototype with `newPrototypeName`/
     * `newPrototypeColor`; otherwise links the group to the existing `nodePrototypeId`.
     * The group's anchor instance is converted to represent the prototype.
     *
     * @param {string} graphId - Graph containing the group.
     * @param {string} groupId - Group to convert.
     * @param {string} nodePrototypeId - Prototype to link (ignored if createNewPrototype=true).
     * @param {boolean} [createNewPrototype=false] - Create a new prototype instead of linking an existing one.
     * @param {string} [newPrototypeName=''] - Name for the new prototype (requires createNewPrototype=true).
     * @param {string} [newPrototypeColor='#8B0000'] - Color for the new prototype.
     * @param {Object} [contextOptions] - Save context flags.
     */
    convertGroupToNodeGroup: (graphId, groupId, nodePrototypeId, createNewPrototype = false, newPrototypeName = '', newPrototypeColor = '#8B0000', contextOptions = {}) => {
      api.setChangeContext({ type: 'group_convert', target: 'group', ...contextOptions });
      return set(produce((draft) => {
        const graph = draft.graphs.get(graphId);
        if (!graph?.groups) {
          console.warn(`[convertGroupToNodeGroup] Graph ${graphId} not found or has no groups.`);
          return;
        }
        const group = graph.groups.get(groupId);
        if (!group) {
          console.warn(`[convertGroupToNodeGroup] Group ${groupId} not found.`);
          return;
        }

        let prototypeId = nodePrototypeId;
        let definitionIndex = 0;

        // Create new prototype if requested
        if (createNewPrototype) {
          prototypeId = uuidv4();
          const newPrototype = {
            id: prototypeId,
            name: newPrototypeName || group.name || 'Untitled',
            description: '',
            picture: '',
            color: newPrototypeColor || group.color || '#8B0000',
            definitionGraphIds: [],
            agentConfig: null, // Agent configuration (null = not an agent)
            createdAt: new Date().toISOString()
          };
          draft.nodePrototypes.set(prototypeId, newPrototype);
        }

        const prototype = draft.nodePrototypes.get(prototypeId);
        if (!prototype) {
          console.warn(`[convertGroupToNodeGroup] Node prototype ${prototypeId} not found.`);
          return;
        }

        // Create a new definition graph from the group's members
        const defGraphId = uuidv4();
        const defGraphData = {
          id: defGraphId,
          name: prototype.name || 'New Thing',
          description: '',
          picture: null,
          color: prototype.color || NODE_DEFAULT_COLOR,
          directed: true,
          instances: new Map(),
          groups: new Map(),
          edgeIds: [],
          definingNodeIds: [prototypeId],
        };

        // Copy member nodes as instances in the definition graph and track mapping
        const instanceIdMap = new Map();
        const memberInstances = [];

        (group.memberInstanceIds || []).forEach(instId => {
          const inst = graph.instances?.get(instId);
          if (inst) {
            memberInstances.push({ instId, instance: inst });
          }
        });

        // Validate: don't create empty definition graphs
        if (memberInstances.length === 0) {
          console.warn(`[convertGroupToNodeGroup] Group ${groupId} has no valid members. Aborting conversion to prevent empty definition.`);
          return;
        }

        memberInstances.forEach(({ instId, instance }) => {
          const newInstId = uuidv4();
          instanceIdMap.set(instId, newInstId);
          defGraphData.instances.set(newInstId, {
            id: newInstId,
            prototypeId: instance.prototypeId,
            x: instance.x,
            y: instance.y,
            scale: instance.scale || 1.0
          });
        });

        // Copy edges between group members to the definition graph with remapped instance IDs
        const memberInstIds = new Set(group.memberInstanceIds || []);
        graph.edgeIds?.forEach(edgeId => {
          const edge = draft.edges.get(edgeId);
          if (!edge) return;

          const sourceMapped = memberInstIds.has(edge.sourceId) ? instanceIdMap.get(edge.sourceId) : null;
          const destMapped = memberInstIds.has(edge.destinationId) ? instanceIdMap.get(edge.destinationId) : null;

          if (sourceMapped && destMapped) {
            const newEdgeId = uuidv4();
            const normalizedDirectionality = normalizeEdgeDirectionality(edge.directionality);
            const newArrowsToward = new Set(normalizedDirectionality.arrowsToward || []);

            if (newArrowsToward.has(edge.sourceId)) {
              newArrowsToward.delete(edge.sourceId);
              newArrowsToward.add(sourceMapped);
            }
            if (newArrowsToward.has(edge.destinationId)) {
              newArrowsToward.delete(edge.destinationId);
              newArrowsToward.add(destMapped);
            }

            const newEdgeData = {
              ...edge,
              id: newEdgeId,
              sourceId: sourceMapped,
              destinationId: destMapped,
              directionality: {
                ...normalizedDirectionality,
                arrowsToward: newArrowsToward
              }
            };
            newEdgeData.graphId = defGraphId;

            if (Array.isArray(edge.definitionNodeIds)) {
              newEdgeData.definitionNodeIds = [...edge.definitionNodeIds];
            }
            if (edge.metadata && typeof edge.metadata === 'object') {
              try {
                newEdgeData.metadata = JSON.parse(JSON.stringify(edge.metadata));
              } catch {
                newEdgeData.metadata = { ...edge.metadata };
              }
            }

            draft.edges.set(newEdgeId, newEdgeData);
            defGraphData.edgeIds.push(newEdgeId);
          }
        });

        draft.graphs.set(defGraphId, defGraphData);

        // Add definition to prototype
        if (!Array.isArray(prototype.definitionGraphIds)) {
          prototype.definitionGraphIds = [];
        }
        prototype.definitionGraphIds.push(defGraphId);
        definitionIndex = prototype.definitionGraphIds.length - 1;

        // Update group with node-group properties
        group.linkedNodePrototypeId = prototypeId;
        group.linkedDefinitionIndex = definitionIndex;
        group.hasCustomLayout = false; // Start with default syncing
        group.color = prototype.color; // Sync color with prototype

        // Create an anchor instance for this thing-group (connection target)
        const anchorId = uuidv4();
        // Position at member centroid
        let anchorX = 0, anchorY = 0;
        if (memberInstances.length > 0) {
          const totals = memberInstances.reduce((acc, { instance }) => {
            acc.x += instance.x ?? 0;
            acc.y += instance.y ?? 0;
            return acc;
          }, { x: 0, y: 0 });
          anchorX = totals.x / memberInstances.length;
          anchorY = totals.y / memberInstances.length;
        }
        graph.instances.set(anchorId, {
          id: anchorId,
          prototypeId: prototypeId,
          x: anchorX,
          y: anchorY,
          scale: 1,
          isGroupAnchor: true,
          anchorForGroupId: groupId
        });
        group.anchorInstanceId = anchorId;

        console.log(`[convertGroupToNodeGroup] Converted group ${groupId} to node-group linked to prototype ${prototypeId}, definition ${definitionIndex}, anchor=${anchorId}`);
      }));
    },


    // This action is deprecated. All loading now goes through loadUniverseFromFile.
    loadGraph: (graphInstance) => { },

    /**
     * Collapses a node-group back into a single node instance (the inverse of decompose).
     *
     * Removes all member instances and their edges from the graph, leaving only the anchor
     * instance. The anchor's prototype retains its definition graph.
     *
     * @param {string} graphId - Graph containing the group.
     * @param {string} groupId - Node-group to combine.
     * @param {Object} [contextOptions] - Save context flags.
     */
    combineNodeGroup: (graphId, groupId, contextOptions = {}) => {
      api.setChangeContext({ type: 'group_combine', target: 'group', ...contextOptions });
      let createdInstanceId = null;
      set(produce((draft) => {
        const graph = draft.graphs.get(graphId);
        if (!graph?.groups) {
          console.warn(`[combineNodeGroup] Graph ${graphId} not found or has no groups.`);
          return;
        }

        const group = graph.groups.get(groupId);
        if (!group) {
          console.warn(`[combineNodeGroup] Group ${groupId} not found.`);
          return;
        }

        if (!group.linkedNodePrototypeId) {
          console.warn(`[combineNodeGroup] Group ${groupId} has no linked prototype; cannot combine.`);
          return;
        }

        const prototype = draft.nodePrototypes.get(group.linkedNodePrototypeId);
        if (!prototype) {
          console.warn(`[combineNodeGroup] Prototype ${group.linkedNodePrototypeId} not found.`);
          return;
        }

        const memberIds = Array.from(new Set(group.memberInstanceIds || []));
        const memberInstances = memberIds
          .map(id => {
            const instance = graph.instances?.get(id);
            return instance ? { id, instance } : null;
          })
          .filter(Boolean);

        // Determine placement for the combined node (use average position of members)
        let position = { x: 0, y: 0 };
        if (memberInstances.length > 0) {
          const totals = memberInstances.reduce((acc, { instance }) => {
            acc.x += instance.x ?? 0;
            acc.y += instance.y ?? 0;
            return acc;
          }, { x: 0, y: 0 });
          position = {
            x: totals.x / memberInstances.length,
            y: totals.y / memberInstances.length
          };
        } else {
          position = {
            x: group.position?.x ?? 0,
            y: group.position?.y ?? 0
          };
        }

        // If the group has an anchor instance, reuse it as the surviving node
        const anchorId = group.anchorInstanceId;
        const anchorInstance = anchorId ? graph.instances?.get(anchorId) : null;
        let survivingInstanceId;

        if (anchorInstance) {
          // Reuse anchor: clear anchor flags, reposition to centroid
          survivingInstanceId = anchorId;
          delete anchorInstance.isGroupAnchor;
          delete anchorInstance.anchorForGroupId;
          anchorInstance.x = position.x;
          anchorInstance.y = position.y;
          createdInstanceId = anchorId;
        } else {
          // No anchor — create a new instance (legacy behavior)
          const newInstanceId = uuidv4();
          survivingInstanceId = newInstanceId;
          createdInstanceId = newInstanceId;
          if (!graph.instances) graph.instances = new Map();
          graph.instances.set(newInstanceId, {
            id: newInstanceId,
            prototypeId: group.linkedNodePrototypeId,
            x: position.x,
            y: position.y,
            scale: 1
          });
        }

        // Transfer edges from members to the surviving instance
        const memberIdSet = new Set(memberIds);
        const edgesToRemove = [];

        draft.edges.forEach((edge, edgeId) => {
          const sourceInGroup = memberIdSet.has(edge.sourceId);
          const destInGroup = memberIdSet.has(edge.destinationId);

          if (!sourceInGroup && !destInGroup) {
            return;
          }

          if (sourceInGroup && destInGroup) {
            edgesToRemove.push(edgeId);
            return;
          }

          const normalized = normalizeEdgeDirectionality(edge.directionality);
          const arrowsToward = new Set(normalized.arrowsToward || []);

          if (sourceInGroup) {
            const oldSource = edge.sourceId;
            edge.sourceId = survivingInstanceId;
            if (arrowsToward.has(oldSource)) {
              arrowsToward.delete(oldSource);
              arrowsToward.add(survivingInstanceId);
            }
          }

          if (destInGroup) {
            const oldDest = edge.destinationId;
            edge.destinationId = survivingInstanceId;
            if (arrowsToward.has(oldDest)) {
              arrowsToward.delete(oldDest);
              arrowsToward.add(survivingInstanceId);
            }
          }

          edge.directionality = {
            ...normalized,
            arrowsToward
          };
        });

        edgesToRemove.forEach(edgeId => {
          draft.edges.delete(edgeId);
          if (graph.edgeIds) {
            const index = graph.edgeIds.indexOf(edgeId);
            if (index > -1) {
              graph.edgeIds.splice(index, 1);
            }
          }
        });

        // Remove member instances from the graph
        memberIds.forEach(memberId => {
          if (graph.instances?.has(memberId)) {
            graph.instances.delete(memberId);
          }
        });

        // Remove the group container itself
        graph.groups.delete(groupId);
      }));

      return createdInstanceId;
    },

    /**
     * Expands a node instance into a node-group by materializing its definition graph in place.
     *
     * Copies all instances and edges from the prototype's definition graph (at `definitionIndex`)
     * into the active graph, then creates a group linking them to the source prototype. The
     * original instance becomes the group anchor. Returns the new group ID.
     *
     * @param {string} graphId - Graph containing the instance to decompose.
     * @param {string} prototypeId - Prototype whose definition graph provides the expansion content.
     * @param {number} [definitionIndex=0] - Which definition graph to expand (0 = first).
     * @param {Object} [contextOptions] - Save context flags.
     * @returns {string|null} The new group ID, or null if decomposition failed.
     */
    decomposeNodeToGroup: (graphId, prototypeId, definitionIndex = 0, contextOptions = {}) => {
      api.setChangeContext({ type: 'group_decompose', target: 'group', ...contextOptions });
      let createdGroupId = null;
      set(produce((draft) => {
        const graph = draft.graphs.get(graphId);
        if (!graph) {
          console.warn(`[decomposeNodeToGroup] Graph ${graphId} not found.`);
          return;
        }

        const prototype = draft.nodePrototypes.get(prototypeId);
        if (!prototype) {
          console.warn(`[decomposeNodeToGroup] Prototype ${prototypeId} not found.`);
          return;
        }

        const definitionGraphIds = Array.isArray(prototype.definitionGraphIds) ? prototype.definitionGraphIds : [];
        if (definitionIndex < 0 || definitionIndex >= definitionGraphIds.length) {
          console.warn(`[decomposeNodeToGroup] Definition index ${definitionIndex} out of range for prototype ${prototypeId}.`);
          return;
        }

        const defGraphId = definitionGraphIds[definitionIndex];
        if (defGraphId === graphId) {
          console.warn(`[decomposeNodeToGroup] Definition graph is the same as the target graph — would cause infinite Map iteration. Aborting.`);
          return;
        }
        const defGraph = draft.graphs.get(defGraphId);
        if (!defGraph) {
          console.warn(`[decomposeNodeToGroup] Definition graph ${defGraphId} not found.`);
          return;
        }

        // Find the instance of this prototype in the target graph
        let originalInstanceId = null;
        for (const [instId, inst] of graph.instances.entries()) {
          if (inst.prototypeId === prototypeId) {
            originalInstanceId = instId;
            break;
          }
        }
        if (!originalInstanceId) {
          console.warn(`[decomposeNodeToGroup] No instance of prototype ${prototypeId} found in graph ${graphId}.`);
          return;
        }

        // Offset the copied network so it lands where the original node was (top-left
        // aligned) instead of at the definition graph's own coordinate origin (which is
        // usually nowhere near the node — causing the group to spawn far down/right).
        const origAnchorInst = graph.instances.get(originalInstanceId);
        const origAnchorX = origAnchorInst?.x ?? 0;
        const origAnchorY = origAnchorInst?.y ?? 0;
        let offsetX = 0, offsetY = 0;
        if (defGraph.instances && defGraph.instances.size > 0) {
          const defInsts = Array.from(defGraph.instances.values());
          const minX = Math.min(...defInsts.map(i => i.x ?? 0));
          const minY = Math.min(...defInsts.map(i => i.y ?? 0));
          offsetX = origAnchorX - minX;
          offsetY = origAnchorY - minY;
        }

        // Copy definition graph instances into the active graph as new member instances
        const instanceIdMap = new Map(); // defInstId -> newInstId
        const memberInstanceIds = [];
        let sumX = 0, sumY = 0, memberCount = 0;

        if (defGraph.instances) {
          for (const [defInstId, defInst] of Array.from(defGraph.instances.entries())) {
            const newInstId = uuidv4();
            instanceIdMap.set(defInstId, newInstId);
            memberInstanceIds.push(newInstId);
            const mx = (defInst.x ?? 0) + offsetX;
            const my = (defInst.y ?? 0) + offsetY;
            graph.instances.set(newInstId, {
              id: newInstId,
              prototypeId: defInst.prototypeId,
              x: mx,
              y: my,
              scale: defInst.scale ?? 1
            });
            sumX += mx;
            sumY += my;
            memberCount++;
          }
        }

        if (memberInstanceIds.length === 0) {
          console.warn(`[decomposeNodeToGroup] Definition graph ${defGraphId} is empty. Aborting decompose.`);
          return;
        }

        // Copy edges between definition members into the active graph
        if (defGraph.edgeIds) {
          for (const edgeId of defGraph.edgeIds) {
            const edge = draft.edges.get(edgeId);
            if (!edge) continue;

            const newSourceId = instanceIdMap.get(edge.sourceId);
            const newDestId = instanceIdMap.get(edge.destinationId);
            if (newSourceId && newDestId) {
              const newEdgeId = uuidv4();
              const normalized = normalizeEdgeDirectionality(edge.directionality);
              const newArrowsToward = new Set(normalized.arrowsToward || []);

              if (newArrowsToward.has(edge.sourceId)) {
                newArrowsToward.delete(edge.sourceId);
                newArrowsToward.add(newSourceId);
              }
              if (newArrowsToward.has(edge.destinationId)) {
                newArrowsToward.delete(edge.destinationId);
                newArrowsToward.add(newDestId);
              }

              const newEdgeData = {
                ...edge,
                id: newEdgeId,
                sourceId: newSourceId,
                destinationId: newDestId,
                directionality: { ...normalized, arrowsToward: newArrowsToward }
              };
              if (Array.isArray(edge.definitionNodeIds)) {
                newEdgeData.definitionNodeIds = [...edge.definitionNodeIds];
              }

              draft.edges.set(newEdgeId, newEdgeData);
              if (!graph.edgeIds) graph.edgeIds = [];
              graph.edgeIds.push(newEdgeId);
            }
          }
        }

        // Mark the original instance as the group anchor (do NOT delete it)
        const groupId = uuidv4();
        const originalInstance = graph.instances.get(originalInstanceId);
        originalInstance.isGroupAnchor = true;
        originalInstance.anchorForGroupId = groupId;

        // Keep the anchor exactly where the original node was — the members were offset to
        // match, so the decomposed group appears in place rather than jumping elsewhere.
        // (originalInstance.x/y are unchanged.)

        // Create the thing-group
        if (!graph.groups) graph.groups = new Map();
        graph.groups.set(groupId, {
          id: groupId,
          name: prototype.name || 'Untitled',
          color: prototype.color || '#8B0000',
          memberInstanceIds,
          linkedNodePrototypeId: prototypeId,
          linkedDefinitionIndex: definitionIndex,
          hasCustomLayout: false,
          anchorInstanceId: originalInstanceId,
          semanticMetadata: {
            type: 'Group',
            relationships: memberInstanceIds.map(memberId => ({
              predicate: 'memberOf',
              subject: memberId,
              object: groupId,
              source: 'redstring-grouping'
            })),
            createdAt: new Date().toISOString(),
            lastModified: new Date().toISOString()
          }
        });

        createdGroupId = groupId;
        console.log(`[decomposeNodeToGroup] Decomposed "${prototype.name}" → thing-group ${groupId} with ${memberInstanceIds.length} members, anchor=${originalInstanceId}`);
      }));
      return createdGroupId;
    },

    // ─── NODE PROTOTYPE MANAGEMENT ───────────────────────────────────────────────

    /**
     * Adds a new node prototype to the global pool and pins it to the right panel.
     *
     * Does nothing if a prototype with the same ID already exists. Auto-generates a UUID
     * if `prototypeData.id` is absent. Sets `agentConfig` to null if not provided.
     *
     * @param {Object} prototypeData - Prototype fields (name, color, description, etc.).
     * @param {string} [prototypeData.id] - Optional ID; auto-generated UUID if omitted.
     */
    addNodePrototype: (prototypeData) => {
      api.setChangeContext({ type: 'prototype_create', target: 'prototype' });
      return set(produce((draft) => {
        const prototypeId = prototypeData.id || uuidv4();
        if (!draft.nodePrototypes.has(prototypeId)) {
          const createdAt = prototypeData.createdAt || new Date().toISOString();
          // Ensure agentConfig defaults to null if not provided
          const agentConfig = prototypeData.agentConfig !== undefined ? prototypeData.agentConfig : null;
          draft.nodePrototypes.set(prototypeId, { ...prototypeData, id: prototypeId, createdAt, agentConfig });

          // Save the new prototype by default
          draft.savedNodeIds.add(prototypeId);
          draft.savedNodeIds = new Set(draft.savedNodeIds);
        }
      }));
    },

    /**
     * Upserts a prototype into the protected catalog so it shows up in All Things
     * and is excluded from cleanup. Intended for local Orbit index entries.
     */
    upsertProtectedPrototype: (prototypeData) => {
      api.setChangeContext({ type: 'prototype_create', target: 'protected_prototype' });
      let prototypeId = prototypeData.id;
      set(produce((draft) => {
        prototypeId = prototypeId || prototypeData.uri || uuidv4();

        const existing = draft.nodePrototypes.get(prototypeId);
        if (existing) {
          draft.nodePrototypes.set(prototypeId, {
            ...existing,
            ...prototypeData,
            id: prototypeId,
            isOrbitCatalog: true,
          });
        } else {
          const createdAt = prototypeData.createdAt || new Date().toISOString();
          draft.nodePrototypes.set(prototypeId, {
            ...prototypeData,
            id: prototypeId,
            createdAt,
            isOrbitCatalog: true,
          });
        }

        if (!draft.protectedPrototypeIds) draft.protectedPrototypeIds = new Set();
        draft.protectedPrototypeIds.add(prototypeId);
      }));
      return prototypeId;
    },

    /**
     * Adds a node prototype with name-based deduplication.
     *
     * If a prototype with the same name (case-insensitive) already exists, merges
     * `semanticMetadata` from the incoming data into the existing prototype and returns
     * the existing ID. Otherwise delegates to `addNodePrototype`.
     *
     * @param {Object} prototypeData - Same shape as `addNodePrototype`.
     * @returns {string} The ID of the existing or newly created prototype.
     */
    addNodePrototypeWithDeduplication: (prototypeData) => {
      let resultId = null;

      set(produce((draft) => {
        // Check for existing nodes with the same name
        const existingNodeWithSameName = Array.from(draft.nodePrototypes.values())
          .find(prototype => prototype.name?.toLowerCase().trim() === prototypeData.name?.toLowerCase().trim());

        if (existingNodeWithSameName) {
          // If found, merge semantic metadata if the new node has it
          if (prototypeData.semanticMetadata && !existingNodeWithSameName.semanticMetadata) {
            existingNodeWithSameName.semanticMetadata = prototypeData.semanticMetadata;
          } else if (prototypeData.semanticMetadata && existingNodeWithSameName.semanticMetadata) {
            // Merge external links and relationships
            const existingLinks = existingNodeWithSameName.semanticMetadata.externalLinks || [];
            const newLinks = prototypeData.semanticMetadata.externalLinks || [];
            const combinedLinks = [...new Set([...existingLinks, ...newLinks])];

            const existingRelationships = existingNodeWithSameName.semanticMetadata.relationships || [];
            const newRelationships = prototypeData.semanticMetadata.relationships || [];
            const combinedRelationships = [...existingRelationships, ...newRelationships];

            existingNodeWithSameName.semanticMetadata = {
              ...existingNodeWithSameName.semanticMetadata,
              ...prototypeData.semanticMetadata,
              externalLinks: combinedLinks,
              relationships: combinedRelationships,
              confidence: Math.max(
                existingNodeWithSameName.semanticMetadata.confidence || 0,
                prototypeData.semanticMetadata.confidence || 0
              )
            };
          }

          // Update description if the existing one is empty and new one has content
          if ((!existingNodeWithSameName.description || existingNodeWithSameName.description.trim() === '')
            && prototypeData.description && prototypeData.description.trim() !== '') {
            existingNodeWithSameName.description = prototypeData.description;
          }

          resultId = existingNodeWithSameName.id;
        } else {
          // No duplicate found, create new node
          const prototypeId = prototypeData.id || uuidv4();
          const createdAt = prototypeData.createdAt || new Date().toISOString();
          draft.nodePrototypes.set(prototypeId, { ...prototypeData, id: prototypeId, createdAt });
          resultId = prototypeId;
        }
      }));

      return resultId;
    },

    /**
     * Identifies pairs of node prototypes whose names are similar enough to be duplicates.
     *
     * Uses Levenshtein distance-based similarity. Returns pairs where both prototypes
     * have similarity ≥ `threshold`. Does not modify state.
     *
     * @param {number} [threshold=0.8] - Similarity threshold in [0, 1].
     * @returns {Array<{proto1: NodePrototype, proto2: NodePrototype, similarity: number}>}
     */
    findPotentialDuplicates: (threshold = 0.8) => {
      const state = get();
      const prototypes = Array.from(state.nodePrototypes.values());
      const duplicateGroups = [];

      for (let i = 0; i < prototypes.length; i++) {
        const current = prototypes[i];
        const duplicates = [];

        for (let j = i + 1; j < prototypes.length; j++) {
          const other = prototypes[j];
          const similarity = calculateStringSimilarity(current.name, other.name);

          if (similarity >= threshold) {
            duplicates.push({
              node: other,
              similarity: similarity,
              reasons: [
                similarity === 1.0 ? 'Exact name match' : `${Math.round(similarity * 100)}% name similarity`
              ]
            });
          }
        }

        if (duplicates.length > 0) {
          duplicateGroups.push({
            primary: current,
            duplicates: duplicates,
            totalNodes: duplicates.length + 1
          });
        }
      }

      return duplicateGroups;
    },

    /**
     * Merges a secondary node prototype into a primary, transferring all instances, edges,
     * and definition graphs to the primary, then deletes the secondary.
     *
     * After the merge: all instances that referenced `secondaryId` are updated to
     * reference `primaryId`; all edges referencing the secondary prototype's instances
     * are preserved; all definition graphs previously owned by the secondary are re-owned
     * by the primary.
     *
     * @param {string} primaryId - The prototype to merge INTO (survives).
     * @param {string} secondaryId - The prototype to merge FROM (deleted after merge).
     */
    mergeNodePrototypes: (primaryId, secondaryId) => set(produce((draft) => {
      const primary = draft.nodePrototypes.get(primaryId);
      const secondary = draft.nodePrototypes.get(secondaryId);

      if (!primary || !secondary) {
        console.error(`[mergeNodePrototypes] Invalid IDs: ${primaryId}, ${secondaryId}`);
        return;
      }

      // Merge semantic metadata
      if (secondary.semanticMetadata) {
        if (!primary.semanticMetadata) {
          primary.semanticMetadata = { ...secondary.semanticMetadata };
        } else {
          // Merge external links
          const existingLinks = primary.semanticMetadata.externalLinks || [];
          const newLinks = secondary.semanticMetadata.externalLinks || [];
          const combinedLinks = [...new Set([...existingLinks, ...newLinks])];

          // Merge relationships
          const existingRelationships = primary.semanticMetadata.relationships || [];
          const newRelationships = secondary.semanticMetadata.relationships || [];
          const combinedRelationships = [...existingRelationships, ...newRelationships];

          primary.semanticMetadata = {
            ...primary.semanticMetadata,
            ...secondary.semanticMetadata,
            externalLinks: combinedLinks,
            relationships: combinedRelationships,
            confidence: Math.max(
              primary.semanticMetadata.confidence || 0,
              secondary.semanticMetadata.confidence || 0
            )
          };
        }
      }

      // Merge descriptions (keep the longer one)
      if (secondary.description && secondary.description.trim() !== '') {
        if (!primary.description || primary.description.trim() === '' ||
          secondary.description.length > primary.description.length) {
          primary.description = secondary.description;
        }
      }

      // Update all instances that reference the secondary prototype, deduplicating per graph
      for (const graph of draft.graphs.values()) {
        if (!graph.instances) continue;

        // Find instances of primary and secondary in this graph
        let primaryInstId = null;
        const secondaryInstIds = [];
        for (const [instId, inst] of graph.instances.entries()) {
          if (inst.prototypeId === primaryId && !primaryInstId) {
            primaryInstId = instId;
          }
          if (inst.prototypeId === secondaryId) {
            secondaryInstIds.push(instId);
          }
        }

        if (secondaryInstIds.length === 0) continue;

        if (primaryInstId) {
          // Graph already has a primary instance — remap edges and remove secondary instances
          for (const secInstId of secondaryInstIds) {
            // Remap edges that reference the secondary instance to the primary instance
            for (const edgeId of (graph.edgeIds || [])) {
              const edge = draft.edges.get(edgeId);
              if (!edge) continue;
              if (edge.sourceId === secInstId) edge.sourceId = primaryInstId;
              if (edge.destinationId === secInstId) edge.destinationId = primaryInstId;
              // Remap directionality set
              if (edge.directionality?.arrowsToward?.has(secInstId)) {
                edge.directionality.arrowsToward.delete(secInstId);
                edge.directionality.arrowsToward.add(primaryInstId);
              }
            }
            // Remove self-loop edges created by the remap
            if (graph.edgeIds) {
              const edgeIdsToRemove = [];
              for (const edgeId of graph.edgeIds) {
                const edge = draft.edges.get(edgeId);
                if (edge && edge.sourceId === edge.destinationId) {
                  edgeIdsToRemove.push(edgeId);
                }
              }
              for (const edgeId of edgeIdsToRemove) {
                graph.edgeIds = graph.edgeIds.filter(id => id !== edgeId);
                draft.edges.delete(edgeId);
              }
            }
            graph.instances.delete(secInstId);
          }
        } else {
          // No primary instance exists — just remap the first secondary, remove the rest
          const [keepInstId, ...extraInstIds] = secondaryInstIds;
          graph.instances.get(keepInstId).prototypeId = primaryId;
          for (const extraId of extraInstIds) {
            // Remap edges from extra duplicates to the kept instance
            for (const edgeId of (graph.edgeIds || [])) {
              const edge = draft.edges.get(edgeId);
              if (!edge) continue;
              if (edge.sourceId === extraId) edge.sourceId = keepInstId;
              if (edge.destinationId === extraId) edge.destinationId = keepInstId;
              if (edge.directionality?.arrowsToward?.has(extraId)) {
                edge.directionality.arrowsToward.delete(extraId);
                edge.directionality.arrowsToward.add(keepInstId);
              }
            }
            // Remove self-loop edges
            if (graph.edgeIds) {
              const edgeIdsToRemove = [];
              for (const edgeId of graph.edgeIds) {
                const edge = draft.edges.get(edgeId);
                if (edge && edge.sourceId === edge.destinationId) {
                  edgeIdsToRemove.push(edgeId);
                }
              }
              for (const edgeId of edgeIdsToRemove) {
                graph.edgeIds = graph.edgeIds.filter(id => id !== edgeId);
                draft.edges.delete(edgeId);
              }
            }
            graph.instances.delete(extraId);
          }
        }
      }

      // Update definition graph references
      if (secondary.definitionGraphIds) {
        primary.definitionGraphIds = primary.definitionGraphIds || [];
        for (const graphId of secondary.definitionGraphIds) {
          if (!primary.definitionGraphIds.includes(graphId)) {
            primary.definitionGraphIds.push(graphId);
          }
        }
      }

      // Update saved node references
      if (draft.savedNodeIds.has(secondaryId)) {
        draft.savedNodeIds.delete(secondaryId);
        draft.savedNodeIds.add(primaryId);
      }

      // Update saved graph references  
      if (draft.savedGraphIds.has(secondaryId)) {
        draft.savedGraphIds.delete(secondaryId);
        draft.savedGraphIds.add(primaryId);
      }

      // Update active definition node if it referenced the secondary
      if (draft.activeDefinitionNodeId === secondaryId) {
        draft.activeDefinitionNodeId = primaryId;
      }

      // Remap right panel tabs referencing the secondary prototype, then deduplicate
      if (Array.isArray(draft.rightPanelTabs)) {
        // If a tab already exists for primaryId, just remove the secondary tab
        const hasPrimaryTab = draft.rightPanelTabs.some(tab => tab && tab.type === 'node' && tab.nodeId === primaryId);
        if (hasPrimaryTab) {
          // Remove any tabs for the secondary node (primary tab already covers it)
          const filtered = draft.rightPanelTabs.filter(tab => !(tab && tab.type === 'node' && tab.nodeId === secondaryId));
          draft.rightPanelTabs.length = 0;
          filtered.forEach(t => draft.rightPanelTabs.push(t));
        } else {
          // No primary tab exists — remap the secondary tab to the primary
          draft.rightPanelTabs.forEach(tab => {
            if (tab && tab.type === 'node' && tab.nodeId === secondaryId) {
              tab.nodeId = primaryId;
              if (primary?.name) tab.title = primary.name;
            }
          });
        }
      }

      // Update type node references in other prototypes
      for (const prototype of draft.nodePrototypes.values()) {
        if (prototype.typeNodeId === secondaryId) {
          prototype.typeNodeId = primaryId;
        }
      }

      // Remap graphs' definingNodeIds from the secondary to the primary
      for (const [graphId, graph] of draft.graphs.entries()) {
        if (Array.isArray(graph.definingNodeIds) && graph.definingNodeIds.includes(secondaryId)) {
          const remapped = graph.definingNodeIds.map(id => id === secondaryId ? primaryId : id);
          // De-duplicate while preserving order
          const seen = new Set();
          const deduped = [];
          for (const id of remapped) {
            if (!seen.has(id)) {
              seen.add(id);
              deduped.push(id);
            }
          }
          graph.definingNodeIds = deduped;
          console.log(`[mergeNodePrototypes] Remapped graph ${graphId} definingNodeIds to`, graph.definingNodeIds);
        }
      }

      // Close redundant active graph tabs (definition graphs of the secondary node)
      if (secondary.definitionGraphIds) {
        for (const graphId of secondary.definitionGraphIds) {
          // Remove from open graphs
          const index = draft.openGraphIds.indexOf(graphId);
          if (index !== -1) {
            draft.openGraphIds.splice(index, 1);
          }

          // Update active graph if it was the merged node's definition
          if (draft.activeGraphId === graphId && primary.definitionGraphIds && primary.definitionGraphIds.length > 0) {
            draft.activeGraphId = primary.definitionGraphIds[0];
          }
        }
      }

      // Note: Node definition indices will be updated if/when that system is implemented

      // Remove the secondary prototype
      draft.nodePrototypes.delete(secondaryId);

      console.log(`[mergeNodePrototypes] Merged ${secondary.name} into ${primary.name}`);
    })),

    /**
     * Merges the definition graphs of two prototypes according to a strategy.
     *
     * Strategies:
     * - `'combine'` (default): Appends secondary's definition graph IDs to primary's list.
     * - `'overwrite_with_primary'`: Secondary's definition graphs are removed.
     * - `'overwrite_with_secondary'`: Primary's definition graphs are replaced with secondary's.
     * - `'selective'`: Only graphs selected via `keepPrimary`/`keepSecondary` booleans are kept.
     *
     * All affected graphs have their `definingNodeIds` updated to reference `primaryId`.
     *
     * @param {string} primaryId - Primary prototype ID.
     * @param {string} secondaryId - Secondary prototype ID.
     * @param {Object} [mergeOptions]
     * @param {'combine'|'overwrite_with_primary'|'overwrite_with_secondary'|'selective'} [mergeOptions.strategy='combine']
     * @param {boolean} [mergeOptions.keepPrimary] - For 'selective': retain primary's graphs.
     * @param {boolean} [mergeOptions.keepSecondary] - For 'selective': retain secondary's graphs.
     */
    mergeDefinitionGraphs: (primaryId, secondaryId, mergeOptions = { strategy: 'combine' }) => set(produce((draft) => {
      const primary = draft.nodePrototypes.get(primaryId);
      const secondary = draft.nodePrototypes.get(secondaryId);

      if (!primary || !secondary) {
        console.error(`[mergeDefinitionGraphs] Invalid IDs: ${primaryId}, ${secondaryId}`);
        return;
      }

      const { strategy, keepPrimary, keepSecondary } = mergeOptions;

      if (strategy === 'overwrite_with_primary') {
        // Keep only primary's definition graphs, close secondary's tabs
        if (secondary.definitionGraphIds) {
          for (const graphId of secondary.definitionGraphIds) {
            const index = draft.openGraphIds.indexOf(graphId);
            if (index !== -1) {
              draft.openGraphIds.splice(index, 1);
            }
          }
        }
        // Primary definition graphs remain unchanged
      }
      else if (strategy === 'overwrite_with_secondary') {
        // Replace primary's definition graphs with secondary's
        if (primary.definitionGraphIds) {
          for (const graphId of primary.definitionGraphIds) {
            const index = draft.openGraphIds.indexOf(graphId);
            if (index !== -1) {
              draft.openGraphIds.splice(index, 1);
            }
          }
        }
        primary.definitionGraphIds = [...(secondary.definitionGraphIds || [])];
      }
      else if (strategy === 'selective') {
        // User chose specific graphs to keep
        const graphsToKeep = [];
        if (keepPrimary && primary.definitionGraphIds) {
          graphsToKeep.push(...primary.definitionGraphIds);
        }
        if (keepSecondary && secondary.definitionGraphIds) {
          graphsToKeep.push(...secondary.definitionGraphIds);
        }

        // Close tabs for graphs not being kept
        const allDefinitionGraphs = [
          ...(primary.definitionGraphIds || []),
          ...(secondary.definitionGraphIds || [])
        ];

        for (const graphId of allDefinitionGraphs) {
          if (!graphsToKeep.includes(graphId)) {
            const index = draft.openGraphIds.indexOf(graphId);
            if (index !== -1) {
              draft.openGraphIds.splice(index, 1);
            }
          }
        }

        primary.definitionGraphIds = [...new Set(graphsToKeep)];
      }
      else {
        // Default: 'combine' - merge all definition graphs
        if (secondary.definitionGraphIds) {
          primary.definitionGraphIds = primary.definitionGraphIds || [];
          for (const graphId of secondary.definitionGraphIds) {
            if (!primary.definitionGraphIds.includes(graphId)) {
              primary.definitionGraphIds.push(graphId);
            }
          }
        }
      }

      // Ensure all graphs previously owned by secondary now reference primary as a defining node
      const graphsToRemap = new Set([
        ...(primary.definitionGraphIds || []),
        ...((secondary.definitionGraphIds || []))
      ]);
      graphsToRemap.forEach(graphId => {
        const graph = draft.graphs.get(graphId);
        if (!graph) return;
        const current = Array.isArray(graph.definingNodeIds) ? graph.definingNodeIds : [];
        if (current.includes(secondaryId) || !current.includes(primaryId)) {
          const replaced = current.map(id => id === secondaryId ? primaryId : id);
          if (!replaced.includes(primaryId)) replaced.unshift(primaryId);
          const seen = new Set();
          const deduped = [];
          for (const id of replaced) {
            if (!seen.has(id)) { seen.add(id); deduped.push(id); }
          }
          graph.definingNodeIds = deduped;
          // Keep the graph listed under primary
        }
      });

      console.log(`[mergeDefinitionGraphs] Merged definition graphs using strategy: ${strategy}`);
    })),

    /**
     * Creates a copy of a node prototype with a " (Copy)" name suffix.
     *
     * The duplicate gets a new UUID and does not share definition graphs with the original.
     * Semantic metadata is shallow-copied with `isMergedNode` cleared.
     *
     * @param {string} prototypeId - ID of the prototype to duplicate.
     * @returns {string} The new duplicate prototype's ID (via Immer return).
     */
    duplicateNodePrototype: (prototypeId) => set(produce((draft) => {
      const original = draft.nodePrototypes.get(prototypeId);
      if (!original) {
        console.error(`[duplicateNodePrototype] Node prototype ${prototypeId} not found`);
        return;
      }

      const newId = uuidv4();
      const duplicated = {
        ...original,
        id: newId,
        name: `${original.name} (Copy)`,
        // Clear semantic metadata to create a true duplicate for testing
        semanticMetadata: original.semanticMetadata ? {
          ...original.semanticMetadata,
          isMergedNode: false,
          mergedFrom: undefined
        } : undefined
      };

      draft.nodePrototypes.set(newId, duplicated);
      console.log(`[duplicateNodePrototype] Created duplicate: ${duplicated.name}`);

      return newId;
    })),

    // ─── NODE INSTANCE MANAGEMENT ────────────────────────────────────────────────

    /**
     * Adds a new instance of a prototype to a specific graph at the given position.
     *
     * @param {string} graphId - ID of the target graph.
     * @param {string} prototypeId - ID of the prototype to instantiate.
     * @param {{x: number, y: number}} position - Canvas coordinates for the new instance.
     * @param {string} [instanceId] - Optional specific instance ID; auto-generated if omitted.
     */
    addNodeInstance: (graphId, prototypeId, position, instanceId = uuidv4()) => {
      api.setChangeContext({ type: 'node_place', target: 'instance', finalize: true });
      return set(produce((draft) => {
        const graph = draft.graphs.get(graphId);
        const prototype = draft.nodePrototypes.get(prototypeId);

        if (!graph || !prototype) {
          console.error(`[addNodeInstance] Invalid graphId (${graphId}) or prototypeId (${prototypeId})`);
          return;
        }

        const newInstance = {
          id: instanceId,
          prototypeId,
          x: position.x,
          y: position.y,
          scale: 1,
        };

        if (!graph.instances) {
          graph.instances = new Map();
        }
        graph.instances.set(instanceId, newInstance);
      }));
    },

    /**
     * Hard-deletes a node instance and all of its connected edges in a single transaction.
     *
     * If the instance is a group anchor, its associated group is also deleted.
     * Removes the instance from any group membership lists. Clears any pending-deletion entry.
     *
     * @param {string} graphId - Graph containing the instance.
     * @param {string} instanceId - Instance to permanently delete.
     */
    removeNodeInstance: (graphId, instanceId) => {
      // Get prototype ID for description context BEFORE entering Immer if possible, or just pass instanceId
      // Ideally we want to know what we are deleting. We can't easily access state outside of set unless we use get().
      const state = get();
      const graph = state.graphs.get(graphId);
      const instance = graph?.instances?.get(instanceId);
      const prototypeId = instance?.prototypeId;

      api.setChangeContext({ type: 'node_delete', target: 'instance', graphId, prototypeId });

      set(produce((draft) => {
        const graph = draft.graphs.get(graphId);
        if (!graph || !graph.instances?.has(instanceId)) {
          console.warn(`[removeNodeInstance] Instance ${instanceId} not found in graph ${graphId}.`);
          return;
        }

        // If this instance is a group anchor, also delete its associated group
        const inst = graph.instances.get(instanceId);
        if (inst?.isGroupAnchor && inst.anchorForGroupId && graph.groups?.has(inst.anchorForGroupId)) {
          console.log(`[removeNodeInstance] Instance ${instanceId} is anchor for group ${inst.anchorForGroupId}, deleting group too.`);
          graph.groups.delete(inst.anchorForGroupId);
        }

        // Delete connected edges first
        const edgesToDelete = [];
        for (const [edgeId, edge] of draft.edges.entries()) {
          if (edge.sourceId === instanceId || edge.destinationId === instanceId) {
            edgesToDelete.push(edgeId);
          }
        }
        edgesToDelete.forEach(edgeId => {
          draft.edges.delete(edgeId);
          if (graph.edgeIds) {
            const index = graph.edgeIds.indexOf(edgeId);
            if (index > -1) graph.edgeIds.splice(index, 1);
          }
        });

        // Delete the instance
        graph.instances.delete(instanceId);

        // Clean up group membership - remove this instance from any groups it belongs to
        if (graph.groups) {
          for (const [groupId, group] of graph.groups.entries()) {
            if (group.memberInstanceIds?.includes(instanceId)) {
              group.memberInstanceIds = group.memberInstanceIds.filter(id => id !== instanceId);
              console.log(`[removeNodeInstance] Removed instance ${instanceId} from group ${groupId}`);
            }
          }
        }

        // Ensure any soft-deletion bookkeeping is cleared
        draft.pendingDeletions.delete(instanceId);

        console.log(`[removeNodeInstance] Permanently deleted instance ${instanceId} and ${edgesToDelete.length} connected edges`);
      }));
    },

    /**
     * Hard-deletes multiple instances and all of their connected edges in a single transaction.
     *
     * @param {string} graphId - Graph containing the instances.
     * @param {string[]|Set<string>} instanceIds - Instances to permanently delete.
     */
    removeMultipleNodeInstances: (graphId, instanceIds) => {
      if (!instanceIds || (instanceIds instanceof Set ? instanceIds.size === 0 : instanceIds.length === 0)) return;

      const instanceIdSet = instanceIds instanceof Set ? instanceIds : new Set(instanceIds);

      api.setChangeContext({
        type: 'node_delete_batch',
        target: 'instance',
        graphId,
        count: instanceIdSet.size
      });

      set(produce((draft) => {
        const graph = draft.graphs.get(graphId);
        if (!graph) return;

        // Find all edges connected to any of the instances being removed
        const edgesToDelete = [];
        for (const [edgeId, edge] of draft.edges.entries()) {
          if (instanceIdSet.has(edge.sourceId) || instanceIdSet.has(edge.destinationId)) {
            edgesToDelete.push(edgeId);
          }
        }

        // Delete the edges
        edgesToDelete.forEach(edgeId => {
          draft.edges.delete(edgeId);
          if (graph.edgeIds) {
            const index = graph.edgeIds.indexOf(edgeId);
            if (index > -1) graph.edgeIds.splice(index, 1);
          }
        });

        // Delete the instances
        instanceIdSet.forEach(instanceId => {
          graph.instances.delete(instanceId);
          draft.pendingDeletions.delete(instanceId);
        });

        // Clean up group membership for all deleted instances
        if (graph.groups) {
          for (const [groupId, group] of graph.groups.entries()) {
            if (group.memberInstanceIds) {
              const originalLength = group.memberInstanceIds.length;
              group.memberInstanceIds = group.memberInstanceIds.filter(id => !instanceIdSet.has(id));
              if (group.memberInstanceIds.length !== originalLength) {
                console.log(`[removeMultipleNodeInstances] Cleaned up ${originalLength - group.memberInstanceIds.length} stale members from group ${groupId}`);
              }
            }
          }
        }

        console.log(`[removeMultipleNodeInstances] Deleted ${instanceIdSet.size} instances and ${edgesToDelete.length} edges`);
      }));
    },

    /**
     * Force-deletes an instance bypassing grace-period protection.
     * Use for programmatic cleanup where soft-delete semantics don't apply.
     * @param {string} graphId
     * @param {string} instanceId
     */
    forceDeleteNodeInstance: (graphId, instanceId) => {
      const state = get();
      const graph = state.graphs.get(graphId);
      const instance = graph?.instances?.get(instanceId);
      const prototypeId = instance?.prototypeId;

      api.setChangeContext({ type: 'node_delete', target: 'instance', graphId, prototypeId });

      set(produce((draft) => {
        const graph = draft.graphs.get(graphId);
        if (!graph || !graph.instances?.has(instanceId)) {
          console.warn(`[forceDeleteNodeInstance] Instance ${instanceId} not found in graph ${graphId}.`);
          return;
        }

        // 1. Delete the instance from the graph
        graph.instances.delete(instanceId);

        // 2. Find all edges connected to this instance and delete them
        const edgesToDelete = [];
        for (const [edgeId, edge] of draft.edges.entries()) {
          if (edge.sourceId === instanceId || edge.destinationId === instanceId) {
            edgesToDelete.push(edgeId);
          }
        }

        edgesToDelete.forEach(edgeId => {
          draft.edges.delete(edgeId);
          // Also remove from the graph's edgeIds list
          if (graph.edgeIds) {
            const index = graph.edgeIds.indexOf(edgeId);
            if (index > -1) {
              graph.edgeIds.splice(index, 1);
            }
          }
        });

        // Remove from pending deletions if it was there
        draft.pendingDeletions.delete(instanceId);

        console.log(`[forceDeleteNodeInstance] Permanently deleted instance ${instanceId}`);
      }));
    },

    /**
     * Restores a soft-deleted instance from `pendingDeletions` back into its graph.
     * @param {string} instanceId - Instance ID in pendingDeletions.
     */
    restoreNodeInstance: (instanceId) => set(produce((draft) => {
      const pendingDeletion = draft.pendingDeletions.get(instanceId);
      if (!pendingDeletion) {
        console.warn(`[restoreNodeInstance] No pending deletion found for instance ${instanceId}.`);
        return;
      }

      const { graphId, instanceData, connectedEdges } = pendingDeletion;
      const graph = draft.graphs.get(graphId);
      if (!graph) {
        console.warn(`[restoreNodeInstance] Graph ${graphId} not found for restoration.`);
        return;
      }

      // Restore the instance
      graph.instances.set(instanceId, instanceData);

      // Restore connected edges
      connectedEdges.forEach(([edgeId, edgeData]) => {
        draft.edges.set(edgeId, edgeData);
        // Add back to graph's edgeIds if not already there
        if (graph.edgeIds && !graph.edgeIds.includes(edgeId)) {
          graph.edgeIds.push(edgeId);
        }
      });

      // Remove from pending deletions
      draft.pendingDeletions.delete(instanceId);

      console.log(`[restoreNodeInstance] Restored instance ${instanceId} from pending deletion`);
    })),

    /**
     * Removes all soft-deleted instances whose grace period has elapsed.
     * Should be called periodically (e.g., on app focus or timer).
     */
    cleanupExpiredDeletions: () => set(produce((draft) => {
      const now = Date.now();
      const expiredIds = [];

      for (const [instanceId, deletion] of draft.pendingDeletions.entries()) {
        if (now - deletion.timestamp > draft.gracePeriodMs) {
          expiredIds.push(instanceId);
        }
      }

      expiredIds.forEach(instanceId => {
        const deletion = draft.pendingDeletions.get(instanceId);
        console.log(`[cleanupExpiredDeletions] Grace period expired for instance ${instanceId}, permanently deleting`);

        // Permanently delete the node and its edges
        const graph = draft.graphs.get(deletion.graphId);
        if (graph) {
          graph.instances.delete(instanceId);

          // Delete connected edges
          deletion.connectedEdges.forEach(([edgeId]) => {
            draft.edges.delete(edgeId);
            if (graph.edgeIds) {
              const index = graph.edgeIds.indexOf(edgeId);
              if (index > -1) {
                graph.edgeIds.splice(index, 1);
              }
            }
          });
        }

        draft.pendingDeletions.delete(instanceId);
      });

      if (expiredIds.length > 0) {
        console.log(`[cleanupExpiredDeletions] Cleaned up ${expiredIds.length} expired deletions`);
      }
    })),

    // ─── NODE & EDGE MUTATIONS ────────────────────────────────────────────────────

    /**
     * Updates a node prototype using an Immer recipe, affecting all its instances visually.
     *
     * Automatically syncs any name change to definition graphs and right-panel tab titles.
     *
     * @param {string} prototypeId - ID of the prototype to update.
     * @param {function} recipe - Immer recipe: `(prototype) => { prototype.name = '...'; }`.
     */
    updateNodePrototype: (prototypeId, recipe) => {
      api.setChangeContext({ type: 'prototype_update', target: 'prototype', prototypeId });
      return set(produce((draft) => {
        const prototype = draft.nodePrototypes.get(prototypeId);
        if (prototype) {
          const originalName = prototype.name;
          recipe(prototype); // Apply Immer updates
          const newName = prototype.name;

          // Sync name change to any graphs defined by this prototype
          if (newName !== originalName && Array.isArray(prototype.definitionGraphIds)) {
            prototype.definitionGraphIds.forEach(graphId => {
              const graph = draft.graphs.get(graphId);
              if (graph) {
                graph.name = newName;
              }
            });
          }

          // Update titles in right panel tabs
          draft.rightPanelTabs.forEach(tab => {
            if (tab.nodeId === prototypeId) {
              tab.title = newName;
            }
          });

        } else {
          console.warn(`updateNodePrototype: Prototype with id ${prototypeId} not found.`);
        }
      }));
    },

    /**
     * Updates a node instance using an Immer recipe.
     *
     * @param {string} graphId - Graph containing the instance.
     * @param {string} instanceId - Instance to update.
     * @param {function} recipe - Immer recipe: `(instance) => { instance.x = 100; }`.
     * @param {Object} [contextOptions] - Save context flags; `contextOptions.type` overrides the change type.
     */
    updateNodeInstance: (graphId, instanceId, recipe, contextOptions = {}) => {
      api.setChangeContext({ type: contextOptions.type || 'node_update', target: 'instance', ...contextOptions });
      return set(produce((draft) => {
        const graph = draft.graphs.get(graphId);
        if (graph && graph.instances) {
          const instance = graph.instances.get(instanceId);
          if (instance) {
            recipe(instance);
          } else {
            console.warn(`updateNodeInstance: Instance ${instanceId} not found in graph ${graphId}.`);
          }
        }
      }));
    },

    /**
     * Updates the (x, y) position of multiple instances in a single transaction.
     *
     * @param {string} graphId - Graph containing the instances.
     * @param {Array<{instanceId: string, x: number, y: number}>} updates - Position updates.
     * @param {Object} [contextOptions] - Save context flags (set isDragging=true during drag).
     */
    updateMultipleNodeInstancePositions: (graphId, updates, contextOptions = {}) => {
      api.setChangeContext({ type: 'node_position', target: 'instance', ...contextOptions });
      return set(produce((draft) => {
        const graph = draft.graphs.get(graphId);
        if (!graph || !graph.instances) return;

        updates.forEach(({ instanceId, x, y }) => {
          const instance = graph.instances.get(instanceId);
          if (instance) {
            instance.x = x;
            instance.y = y;
          }
        });
      }));
    },

    /**
     * Pastes nodes and edges as an atomic operation — used by the copy/paste system.
     *
     * Skips any edge whose source or destination instance is missing from the graph
     * (guards against stale clipboard data).
     *
     * @param {string} graphId - Target graph for the paste.
     * @param {Array<{instanceId: string, prototypeId: string, x: number, y: number, scale: number}>} nodes
     * @param {Array<EdgeData>} edges - Edges to restore; each must have valid source/destination IDs.
     * @param {Object} [contextOptions] - Save context flags.
     */
    pasteNodesAndEdges: (graphId, nodes, edges, contextOptions = {}) => {
      api.setChangeContext({ type: 'paste', target: 'batch', ...contextOptions });
      return set(produce((draft) => {
        const graph = draft.graphs.get(graphId);
        if (!graph) return;

        // Add all node instances
        for (const node of nodes) {
          graph.instances.set(node.instanceId, {
            id: node.instanceId,
            prototypeId: node.prototypeId,
            x: node.x,
            y: node.y,
            scale: node.scale || 1
          });
        }

        // Add all edges — skip any whose endpoints aren't in the graph's instances
        // (matches the validation in addEdge and applyBulkGraphUpdates; prevents orphan
        // edges from persisting if clipboard data is stale).
        for (const edge of edges) {
          const edgeId = edge.id;
          if (!graph.instances?.has(edge.sourceId) || !graph.instances?.has(edge.destinationId)) {
            console.warn('[pasteNodesAndEdges] Skipping edge with missing endpoint', {
              edgeId,
              sourceId: edge.sourceId,
              destinationId: edge.destinationId,
              sourcePresent: graph.instances?.has(edge.sourceId),
              destPresent: graph.instances?.has(edge.destinationId),
            });
            continue;
          }
          draft.edges.set(edgeId, edge);
          graph.edgeIds.push(edgeId);
        }
      }));
    },

    // ─── EDGE MANAGEMENT ─────────────────────────────────────────────────────────

    /**
     * Connects two node instances with an edge in a single transaction.
     *
     * Validates that both instance IDs exist in the graph. Skips silently if the
     * edge ID already exists. Defaults to `base-connection-prototype` edge type if
     * `typeNodeId` is absent. Normalizes `directionality.arrowsToward` to a Set.
     *
     * @param {string} graphId - Graph containing both instances.
     * @param {EdgeData} newEdgeData - Edge descriptor; must include `id`, `sourceId`, `destinationId`.
     * @param {Object} [contextOptions] - Save context flags.
     */
    addEdge: (graphId, newEdgeData, contextOptions = {}) => {
      // #region agent log
      debugLogSync('graphStore.js:addEdge', 'addEdge called', { graphId, edgeId: newEdgeData?.id, sourceId: newEdgeData?.sourceId, destId: newEdgeData?.destinationId, stack: new Error().stack?.split('\n').slice(1, 5) }, 'debug-session', 'A-B');
      // #endregion

      // Resolve names for history
      const state = get();
      const graph = state.graphs.get(graphId);
      let sourceName = 'Unknown';
      let targetName = 'Unknown';

      if (graph && graph.instances) {
        const sourceInst = graph.instances.get(newEdgeData.sourceId);
        const destInst = graph.instances.get(newEdgeData.destinationId);

        if (sourceInst) {
          const proto = state.nodePrototypes.get(sourceInst.prototypeId);
          sourceName = proto?.name || 'Node';
        }
        if (destInst) {
          const proto = state.nodePrototypes.get(destInst.prototypeId);
          targetName = proto?.name || 'Node';
        }
      }

      api.setChangeContext({
        type: 'edge_create',
        target: 'edge',
        finalize: true,
        sourceName,
        targetName,
        ...contextOptions
      });

      return set(produce((draft) => {
        const graph = draft.graphs.get(graphId);
        if (!graph) {
          console.error(`[addEdge] Graph with ID ${graphId} not found.`);
          return;
        }

        const { id: edgeId, sourceId: sourceInstanceId, destinationId: destInstanceId } = newEdgeData;
        if (!edgeId || !sourceInstanceId || !destInstanceId) {
          console.error("[addEdge] newEdgeData requires id, sourceId, and destinationId.");
          return;
        }

        // Ensure source and dest instances exist in the graph
        if (!graph.instances?.has(sourceInstanceId) || !graph.instances?.has(destInstanceId)) {
          console.error(`[addEdge] Source or destination instance not found in graph ${graphId}.`);
          return;
        }

        // #region agent log
        // Check for existing edges between same nodes
        const existingEdges = Array.from(draft.edges.values()).filter(e =>
          (e.sourceId === sourceInstanceId && e.destinationId === destInstanceId) ||
          (e.sourceId === destInstanceId && e.destinationId === sourceInstanceId)
        );
        debugLogSync('graphStore.js:addEdge:check', 'Checking existing edges', { edgeId, sourceId: sourceInstanceId, destId: destInstanceId, existingEdgeCount: existingEdges.length, existingEdgeIds: existingEdges.map(e => e.id) }, 'debug-session', 'B');
        // #endregion

        if (!draft.edges.has(edgeId)) {
          newEdgeData.directionality = normalizeEdgeDirectionality(newEdgeData.directionality);
          // Assign default edge type if not specified
          if (!newEdgeData.typeNodeId) {
            newEdgeData.typeNodeId = 'base-connection-prototype';
          }
          draft.edges.set(edgeId, newEdgeData);

          if (!graph.edgeIds) {
            graph.edgeIds = [];
          }
          graph.edgeIds.push(edgeId);
          // #region agent log
          debugLogSync('graphStore.js:addEdge:created', 'Edge created', { edgeId, totalEdgesNow: graph.edgeIds.length }, 'debug-session', 'A-B');
          // #endregion
        } else {
          // #region agent log
          debugLogSync('graphStore.js:addEdge:skip', 'Edge already exists - skipped', { edgeId }, 'debug-session', 'A');
          // #endregion
        }
      }));
    },

    /**
     * Updates an edge using an Immer recipe.
     *
     * @param {string} edgeId - ID of the edge to update.
     * @param {function} recipe - Immer recipe: `(edge) => { edge.name = '...'; }`.
     */
    updateEdge: (edgeId, recipe) => set(produce((draft) => {
      const edge = draft.edges.get(edgeId);
      if (edge) {
        recipe(edge); // Apply the Immer updates
      } else {
        console.warn(`updateEdge: Edge with id ${edgeId} not found.`);
      }
    })),

    /**
     * Sets the type prototype for a node in the abstraction hierarchy.
     *
     * Guards against circular typing and prevents reassigning the root `base-thing-prototype`.
     * Pass `null` to remove the type assignment.
     *
     * @param {string} nodeId - Prototype ID of the node to retype.
     * @param {string|null} typeNodeId - ID of the prototype to use as the type, or null to clear.
     */
    setNodeType: (nodeId, typeNodeId) => {
      api.setChangeContext({ type: 'node_type_change', target: 'prototype', nodeId, typeNodeId });
      return set(produce((draft) => {
        const node = draft.nodePrototypes.get(nodeId);
        if (!node) {
          console.warn(`setNodeType: Node prototype ${nodeId} not found.`);
          return;
        }

        // Prevent the base "Thing" type from being assigned a type
        if (nodeId === 'base-thing-prototype' && typeNodeId !== null) {
          console.warn(`setNodeType: The base "Thing" type cannot be assigned a type. It must remain the fundamental type.`);
          return;
        }

        // Validate that the type node exists (if not null)
        if (typeNodeId !== null && !draft.nodePrototypes.has(typeNodeId)) {
          console.warn(`setNodeType: Type node ${typeNodeId} not found.`);
          return;
        }

        // Prevent circular typing (a node cannot be typed by itself or by a node it already types)
        if (typeNodeId === nodeId) {
          console.warn(`setNodeType: Node ${nodeId} cannot be typed by itself.`);
          return;
        }

        // Check for indirect circular typing by traversing the type chain
        if (typeNodeId !== null) {
          let currentTypeId = typeNodeId;
          const visited = new Set();
          while (currentTypeId && !visited.has(currentTypeId)) {
            visited.add(currentTypeId);
            const currentTypeNode = draft.nodePrototypes.get(currentTypeId);
            if (currentTypeNode?.typeNodeId === nodeId) {
              console.warn(`setNodeType: Circular typing detected. Node ${nodeId} cannot be typed by ${typeNodeId}.`);
              return;
            }
            currentTypeId = currentTypeNode?.typeNodeId;
          }
        }

        node.typeNodeId = typeNodeId;
        console.log(`setNodeType: Set type of node ${nodeId} to ${typeNodeId || 'null'}.`);
      }));
    },

    /**
     * Adds a new edge prototype (connection type) to the edge prototype catalog.
     * Does nothing if an edge prototype with the same ID already exists.
     *
     * @param {Object} prototypeData - Edge prototype fields (id, name, color, description, etc.).
     */
    addEdgePrototype: (prototypeData) => set(produce((draft) => {
      const prototypeId = prototypeData.id || uuidv4();
      if (!draft.edgePrototypes.has(prototypeId)) {
        draft.edgePrototypes.set(prototypeId, { ...prototypeData, id: prototypeId });
      }
    })),

    /**
     * Updates an edge prototype using an Immer recipe.
     * Prevents changing the type of the root `base-connection-prototype`.
     *
     * @param {string} prototypeId - ID of the edge prototype to update.
     * @param {function} recipe - Immer recipe applied to the edge prototype.
     */
    updateEdgePrototype: (prototypeId, recipe) => set(produce((draft) => {
      const prototype = draft.edgePrototypes.get(prototypeId);
      if (prototype) {
        const originalTypeNodeId = prototype.typeNodeId;
        recipe(prototype); // Apply Immer updates

        // Prevent the base "Connection" type from being changed
        if (prototypeId === 'base-connection-prototype' && prototype.typeNodeId !== originalTypeNodeId) {
          console.warn(`updateEdgePrototype: Cannot change the type of the base "Connection" prototype. Attempted to change from ${originalTypeNodeId} to ${prototype.typeNodeId}`);
          prototype.typeNodeId = originalTypeNodeId; // Restore original value
        }
      } else {
        console.warn(`updateEdgePrototype: Edge prototype with id ${prototypeId} not found.`);
      }
    })),

    /**
     * Sets the type prototype for an edge.
     * Validates that the type exists in `edgePrototypes`. Pass `null` to clear.
     *
     * @param {string} edgeId - ID of the edge to retype.
     * @param {string|null} typeNodeId - ID of the edge prototype to use as type, or null.
     */
    setEdgeType: (edgeId, typeNodeId) => set(produce((draft) => {
      const edge = draft.edges.get(edgeId);
      if (!edge) {
        console.warn(`setEdgeType: Edge ${edgeId} not found.`);
        return;
      }

      // Validate that the type node exists (if not null)
      if (typeNodeId !== null && !draft.edgePrototypes.has(typeNodeId)) {
        console.warn(`setEdgeType: Edge type ${typeNodeId} not found.`);
        return;
      }

      edge.typeNodeId = typeNodeId;
      console.log(`setEdgeType: Set type of edge ${edgeId} to ${typeNodeId || 'null'}.`);
    })),

    // Deprecated actions, kept for API consistency during refactor if needed, but should not be used.
    addNode: () => console.warn("`addNode` is deprecated. Use `addNodePrototype` and `addNodeInstance`."),
    updateNode: () => console.warn("`updateNode` is deprecated. Use `updateNodePrototype` or `updateNodeInstance`."),
    updateMultipleNodePositions: () => console.warn("`updateMultipleNodePositions` is deprecated. Use `updateMultipleNodeInstancePositions`."),
    removeNode: () => console.warn("`removeNode` is deprecated. Use `removeNodeInstance`."),
    /**
     * Removes an edge from the store and from its graph's `edgeIds` list.
     *
     * @param {string} edgeId - ID of the edge to remove.
     * @param {Object} [contextOptions] - Save context flags.
     */
    removeEdge: (edgeId, contextOptions = {}) => {
      api.setChangeContext({ type: 'edge_delete', target: 'edge', finalize: true, ...contextOptions });
      return set(produce((draft) => {
        const edge = draft.edges.get(edgeId);
        if (!edge) {
          console.warn(`[Store removeEdge] Edge with ID ${edgeId} not found.`);
          return;
        }

        // Remove from global edges Map
        draft.edges.delete(edgeId);

        // Remove from graph's edgeIds list
        for (const [graphId, graph] of draft.graphs.entries()) {
          if (graph.edgeIds && graph.edgeIds.includes(edgeId)) {
            const index = graph.edgeIds.indexOf(edgeId);
            if (index > -1) {
              graph.edgeIds.splice(index, 1);
            }
            break;
          }
        }

        // Clear selection if this edge was selected
        if (draft.selectedEdgeId === edgeId) {
          draft.selectedEdgeId = null;
        }

        console.log(`[Store removeEdge] Edge ${edgeId} removed successfully.`);
      }));
    },


    // ─── GRAPH TAB NAVIGATION ─────────────────────────────────────────────────────

    /**
     * Opens a graph in the tab bar and makes it the active graph.
     *
     * If the graph is already open, it is simply activated (not duplicated). Also
     * sets `activeDefinitionNodeId` to the provided `definitionNodeId`, or clears it
     * if none is given. Auto-expands the graph in the "Open Things" list.
     *
     * @param {string} graphId - ID of the graph to open.
     * @param {string|null} [definitionNodeId=null] - Prototype ID to track as the active definition context.
     */
    openGraphTab: (graphId, definitionNodeId = null) => set(produce((draft) => {
      console.log(`[Store openGraphTab] Called with graphId: ${graphId}, definitionNodeId: ${definitionNodeId}`);
      if (draft.graphs.has(graphId)) { // Ensure graph exists
        // Add to open list if not already there (add to TOP of list)
        if (!draft.openGraphIds.includes(graphId)) {
          draft.openGraphIds.unshift(graphId);
        }
        // Set this graph as the active one
        draft.activeGraphId = graphId;

        // Auto-expand the newly opened graph in the "Open Things" list
        draft.expandedGraphIds.add(graphId);

        console.log(`[Store openGraphTab] Set activeGraphId to: ${graphId} and auto-expanded.`);

        // Set the definition node ID if provided
        if (definitionNodeId) {
          console.log(`[Store openGraphTab] Setting activeDefinitionNodeId to: ${definitionNodeId}`);
          draft.activeDefinitionNodeId = definitionNodeId;
        } else {
          // If opening a graph tab without a specific definition node, clear the active definition node
          console.log(`[Store openGraphTab] No definitionNodeId provided, clearing activeDefinitionNodeId.`);
          draft.activeDefinitionNodeId = null;
        }

        // <<< ADD: Ensure the opened graph is expanded in the list >>>
        draft.expandedGraphIds.add(graphId);
        console.log(`[Store openGraphTab] Added ${graphId} to expanded set.`);

      } else {
        console.warn(`[Store openGraphTab] Graph ${graphId} not found.`);
      }
    })),

    /**
     * Removes a graph from the open tab list.
     * If it was the active graph, activates the first remaining open graph.
     *
     * @param {string} graphId - ID of the graph tab to close.
     */
    closeGraphTab: (graphId) => set(produce((draft) => {
      draft.openGraphIds = draft.openGraphIds.filter(id => id !== graphId);
      if (draft.activeGraphId === graphId) {
        draft.activeGraphId = draft.openGraphIds.length > 0 ? draft.openGraphIds[0] : null;
      }
    })),

    /**
     * Sets the active graph tab without opening or closing any tabs.
     * Requires the graph to already be in `openGraphIds`. Pass `null` to clear.
     *
     * @param {string|null} graphId - ID of the graph to activate.
     */
    setActiveGraphTab: (graphId) => set(produce((draft) => {
      if (graphId === null) {
        draft.activeGraphId = null;
        return;
      }
      if (draft.openGraphIds.includes(graphId)) {
        draft.activeGraphId = graphId;
      } else if (draft.graphs.has(graphId)) {
        console.warn(`Graph ${graphId} exists but is not open. Cannot set as active tab.`);
      } else {
        console.warn(`Cannot set active tab: Graph with id ${graphId} not found or not open.`);
      }
    })),

    /**
     * Applies a batch of nodes, edges, and groups to an existing graph in one transaction.
     *
     * Handles deduplication: nodes with matching names are reused, edges between the same
     * pair with the same type are updated rather than duplicated. Creates connection-type
     * prototypes for named edge types on the fly. Accepts node names by string for edges,
     * resolving them via a case-insensitive lookup map.
     *
     * @param {string} graphId - Target graph ID.
     * @param {Object} batch
     * @param {Array<{name: string, color?: string, description?: string, x?: number, y?: number, prototypeId?: string, instanceId?: string}>} [batch.nodes=[]]
     * @param {Array<{source: string, target: string, type?: string, directionality?: string, definitionNode?: Object}>} [batch.edges=[]]
     * @param {Array<{name: string, memberNames?: string[], memberInstanceIds?: string[]}>} [batch.groups=[]]
     */
    applyBulkGraphUpdates: (graphId, { nodes = [], edges = [], groups = [] }) => {
      api.setChangeContext({ type: 'bulk_update', target: 'graph', finalize: true });
      set(produce((draft) => {
        const graph = draft.graphs.get(graphId);
        if (!graph) {
          console.error(`[applyBulkGraphUpdates] Graph ${graphId} not found.`);
          return;
        }

        const nodeIdMap = new Map(); // name -> instanceId
        const nodeIdMapNormalized = new Map(); // normalized name -> instanceId (for fuzzy matching)

        // Helper to normalize names for fuzzy matching
        const normalizeName = (name) => (name || '').toLowerCase().trim();

        // Pre-populate with EXISTING nodes so edges can reference them
        // (critical for expandGraph where new edges connect to existing graph nodes)
        if (graph.instances) {
          graph.instances.forEach((inst, instanceId) => {
            const proto = draft.nodePrototypes.get(inst.prototypeId);
            if (proto?.name) {
              nodeIdMap.set(proto.name, instanceId);
              nodeIdMapNormalized.set(normalizeName(proto.name), instanceId);
            }
          });
          console.log(`[applyBulkGraphUpdates] Pre-populated ${nodeIdMap.size} existing nodes into lookup map`);
        }

        // 1. Add nodes (skip duplicates if a node with the same name already exists in this graph)
        nodes.forEach(node => {
          const normalizedName = normalizeName(node.name);

          // DUPLICATE PREVENTION: If a node with this name already exists in the graph, reuse it
          const existingInstanceId = nodeIdMapNormalized.get(normalizedName);
          if (existingInstanceId && graph.instances.has(existingInstanceId)) {
            const existingInst = graph.instances.get(existingInstanceId);
            const existingProto = draft.nodePrototypes.get(existingInst.prototypeId);
            if (existingProto) {
              // Update description/color if new values are provided
              if (node.description && node.description.trim()) {
                existingProto.description = node.description;
              }
              if (node.color) {
                existingProto.color = node.color;
              }
            }
            console.warn(`[applyBulkGraphUpdates] DUPLICATE PREVENTED: Node "${node.name}" already exists in graph, reusing instance ${existingInstanceId}`);
            return; // skip — nodeIdMap already has the correct entry
          }

          const protoId = node.prototypeId || uuidv4();
          const instanceId = node.instanceId || uuidv4();

          // Add prototype if it doesn't exist
          if (!draft.nodePrototypes.has(protoId)) {
            draft.nodePrototypes.set(protoId, {
              id: protoId,
              name: node.name,
              color: node.color || NODE_DEFAULT_COLOR,
              description: node.description || '',
              typeNodeId: node.typeNodeId || null,
              definitionGraphIds: [],
              createdAt: new Date().toISOString(),
              // Carry provenance (and any other semanticMetadata) when supplied —
              // e.g. wizard-authored nodes stamped with PROV (P2.6).
              ...(node.semanticMetadata ? { semanticMetadata: node.semanticMetadata } : {})
            });

            // Save the new prototype by default
            draft.savedNodeIds.add(protoId);
            draft.savedNodeIds = new Set(draft.savedNodeIds);
          }

          // Add instance to graph
          if (!graph.instances) graph.instances = new Map();
          graph.instances.set(instanceId, {
            id: instanceId,
            prototypeId: protoId,
            x: node.x ?? (Math.random() * 500 + 100),
            y: node.y ?? (Math.random() * 400 + 100),
            scale: 1
          });

          nodeIdMap.set(node.name, instanceId);
          nodeIdMapNormalized.set(normalizeName(node.name), instanceId);
        });

        console.log(`[applyBulkGraphUpdates] Node names in map:`, Array.from(nodeIdMap.keys()));
        console.log(`[applyBulkGraphUpdates] Normalized names in map:`, Array.from(nodeIdMapNormalized.keys()));

        // Helper to convert to Title Case
        const toTitleCase = (str) => {
          if (!str) return '';
          return str.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
        };

        // Helper to generate a color for connection types
        const generateConnectionColor = (name) => {
          // Simple hash-based color generation for consistency
          let hash = 0;
          for (let i = 0; i < name.length; i++) {
            hash = name.charCodeAt(i) + ((hash << 5) - hash);
          }
          const hue = Math.abs(hash) % 360;
          return `hsl(${hue}, 60%, 45%)`;
        };

        // Cache for connection definition prototypes to avoid duplicates
        const connectionProtoCache = new Map();

        // 2. Add edges
        console.log(`[applyBulkGraphUpdates] Processing ${edges.length} edges...`);
        edges.forEach((edge, idx) => {
          console.log(`[applyBulkGraphUpdates] Edge ${idx}: source="${edge.source}", target="${edge.target}", type="${edge.type}"`);

          // Try exact match first, then normalized match
          let sourceId = edge.sourceId || nodeIdMap.get(edge.source) || nodeIdMapNormalized.get(normalizeName(edge.source));
          let destId = edge.destinationId || edge.targetId || nodeIdMap.get(edge.target) || nodeIdMapNormalized.get(normalizeName(edge.target));

          console.log(`[applyBulkGraphUpdates] Edge ${idx}: sourceId=${sourceId ? 'FOUND' : 'NOT_FOUND'}, destId=${destId ? 'FOUND' : 'NOT_FOUND'}`);

          if (sourceId && destId && graph.instances.has(sourceId) && graph.instances.has(destId)) {
            const edgeId = edge.id || uuidv4();

            // DUPLICATE EDGE PREVENTION: Only block if same nodes AND same connection type
            // Different types between the same pair are allowed (e.g., A→B "Loves" + A→B "Rivals With")
            const newTypeName = toTitleCase(edge.definitionNode?.name || edge.type || 'Connection');
            let existingEdgeId = null;
            for (const eId of (graph.edgeIds || [])) {
              const existingEdge = draft.edges.get(eId);
              if (existingEdge && (
                (existingEdge.sourceId === sourceId && existingEdge.destinationId === destId) ||
                (existingEdge.sourceId === destId && existingEdge.destinationId === sourceId)
              )) {
                const existingTypeName = existingEdge.name || '';
                if (existingTypeName.toLowerCase() === newTypeName.toLowerCase()) {
                  existingEdgeId = eId;
                  break;
                }
              }
            }

            if (existingEdgeId) {
              // Edge already exists — update it instead of creating a duplicate
              console.warn(`[applyBulkGraphUpdates] DUPLICATE PREVENTED: Edge already exists between "${edge.source}" and "${edge.target}" (${existingEdgeId}). Updating existing edge instead.`);
              const existingEdge = draft.edges.get(existingEdgeId);

              // Build the new definition info
              const defNode = edge.definitionNode;
              const connectionTypeName = toTitleCase(defNode?.name || edge.type || 'Connection');
              const connectionColor = defNode?.color || edge.color || null;
              const connectionDescription = defNode?.description || '';

              if (connectionTypeName && connectionTypeName !== 'Connection' && connectionTypeName !== 'Relates To') {
                let defProtoId = connectionProtoCache.get(connectionTypeName);
                if (!defProtoId) {
                  // Check if prototype already exists by name
                  draft.nodePrototypes.forEach((proto, protoId) => {
                    if (proto.name?.toLowerCase() === connectionTypeName.toLowerCase()) {
                      defProtoId = protoId;
                    }
                  });
                  if (!defProtoId) {
                    defProtoId = `proto-conn-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 8)}`;
                    draft.nodePrototypes.set(defProtoId, {
                      id: defProtoId,
                      name: connectionTypeName,
                      description: connectionDescription || `Defines the "${connectionTypeName}" relationship`,
                      color: connectionColor || generateConnectionColor(connectionTypeName),
                      typeNodeId: null,
                      definitionGraphIds: [],
                      createdAt: new Date().toISOString()
                    });

                    // Save the new connection prototype by default
                    draft.savedNodeIds.add(defProtoId);
                    draft.savedNodeIds = new Set(draft.savedNodeIds);
                  }
                  connectionProtoCache.set(connectionTypeName, defProtoId);
                }
                existingEdge.definitionNodeIds = [defProtoId];
              }

              existingEdge.name = connectionTypeName;
              existingEdge.type = edge.type || connectionTypeName;

              // Update directionality
              const dir = edge.directionality || 'unidirectional';
              if (dir === 'bidirectional') {
                existingEdge.directionality = { arrowsToward: new Set([sourceId, destId]) };
              } else if (dir === 'none' || dir === 'undirected') {
                existingEdge.directionality = { arrowsToward: new Set() };
              } else if (dir === 'reverse') {
                existingEdge.directionality = { arrowsToward: new Set([sourceId]) };
              } else {
                existingEdge.directionality = { arrowsToward: new Set([destId]) };
              }

              console.log(`[applyBulkGraphUpdates] Updated existing edge ${existingEdgeId} to type "${connectionTypeName}"`);
            } else if (!draft.edges.has(edgeId)) {
              // Handle connection definition node - create a prototype for the connection type
              let definitionNodeIds = [];

              // Get connection name from definitionNode object or type field
              const defNode = edge.definitionNode;
              const connectionTypeName = toTitleCase(
                defNode?.name || edge.type || 'Connection'
              );
              const connectionColor = defNode?.color || edge.color || null;
              const connectionDescription = defNode?.description || '';

              if (connectionTypeName && connectionTypeName !== 'Connection' && connectionTypeName !== 'Relates To') {
                // Check cache first
                if (connectionProtoCache.has(connectionTypeName)) {
                  definitionNodeIds = [connectionProtoCache.get(connectionTypeName)];
                } else {
                  // Check if prototype already exists with this name
                  let existingProtoId = null;
                  draft.nodePrototypes.forEach((proto, protoId) => {
                    if (proto.name?.toLowerCase() === connectionTypeName.toLowerCase()) {
                      existingProtoId = protoId;
                    }
                  });

                  if (existingProtoId) {
                    definitionNodeIds = [existingProtoId];
                    connectionProtoCache.set(connectionTypeName, existingProtoId);
                    console.log(`[applyBulkGraphUpdates] Reusing connection prototype: "${connectionTypeName}" (${existingProtoId})`);
                  } else {
                    // Create new prototype for this connection type
                    const defProtoId = `proto-conn-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 8)}`;
                    draft.nodePrototypes.set(defProtoId, {
                      id: defProtoId,
                      name: connectionTypeName,
                      description: connectionDescription || `Defines the "${connectionTypeName}" relationship`,
                      color: connectionColor || generateConnectionColor(connectionTypeName),
                      typeNodeId: null,
                      definitionGraphIds: [],
                      createdAt: new Date().toISOString()
                    });

                    // Save the new connection prototype by default
                    draft.savedNodeIds.add(defProtoId);
                    draft.savedNodeIds = new Set(draft.savedNodeIds);

                    definitionNodeIds = [defProtoId];
                    connectionProtoCache.set(connectionTypeName, defProtoId);
                    console.log(`[applyBulkGraphUpdates] Created connection prototype: "${connectionTypeName}" (${defProtoId})`);
                  }
                }
              }

              // Handle directionality - convert string to arrowsToward Set
              let arrowsToward = new Set([destId]); // Default: unidirectional to target
              const dir = edge.directionality || 'unidirectional';
              if (dir === 'bidirectional') {
                arrowsToward = new Set([sourceId, destId]);
              } else if (dir === 'none' || dir === 'undirected') {
                arrowsToward = new Set();
              } else if (dir === 'reverse') {
                arrowsToward = new Set([sourceId]);
              }

              const edgeData = {
                id: edgeId,
                sourceId: sourceId,
                destinationId: destId,
                name: connectionTypeName,
                type: edge.type || connectionTypeName,
                typeNodeId: edge.typeNodeId || 'base-connection-prototype',
                definitionNodeIds: definitionNodeIds,
                directionality: { arrowsToward }
              };
              draft.edges.set(edgeId, edgeData);
              if (!graph.edgeIds) graph.edgeIds = [];
              graph.edgeIds.push(edgeId);
              console.log(`[applyBulkGraphUpdates] Created edge: ${edge.source || 'unknown'} → ${edge.target || 'unknown'} (${connectionTypeName}) with definitionNodeIds:`, definitionNodeIds);
            }
          } else {
            console.warn(`[applyBulkGraphUpdates] Skipping edge - source "${edge.source}" (${sourceId ? 'found' : 'NOT FOUND'}) or target "${edge.target}" (${destId ? 'found' : 'NOT FOUND'})`, edge);
          }
        });

        // 3. Add groups
        groups.forEach(group => {
          const groupId = group.id || uuidv4();
          // Try exact match first, then normalized match for each member
          const memberInstanceIds = group.memberInstanceIds || (group.memberNames || [])
            .map(name => nodeIdMap.get(name) || nodeIdMapNormalized.get(normalizeName(name)))
            .filter(Boolean);

          if (memberInstanceIds.length > 0) {
            if (!graph.groups) graph.groups = new Map();
            graph.groups.set(groupId, {
              id: groupId,
              name: group.name || 'Group',
              color: group.color || '#8B0000',
              memberInstanceIds
            });
            console.log(`[applyBulkGraphUpdates] Created group "${group.name}" with ${memberInstanceIds.length} members`);
          } else {
            console.warn(`[applyBulkGraphUpdates] Skipping group "${group.name}" - no valid members found from:`, group.memberNames);
          }
        });

        console.log(`[applyBulkGraphUpdates] Applied ${nodes.length} nodes, ${edges.length} edges, and ${groups.length} groups to graph ${graphId}`);
      }));
    },

    // ─── GRAPH CRUD ───────────────────────────────────────────────────────────────

    /**
     * Creates a new graph paired with a defining prototype, and activates it.
     *
     * Both the graph and its owning prototype are assigned new UUIDs (unless
     * `initialData.id` provides a specific graph ID). The graph is opened as a tab,
     * its defining prototype is pinned to the right panel, and `activeDefinitionNodeId`
     * is set to the new prototype.
     *
     * @param {Object} [initialData]
     * @param {string} [initialData.id] - Specific graph ID; auto-generated UUID if omitted.
     * @param {string} [initialData.name='New Thing'] - Name for both the graph and its prototype.
     * @param {string} [initialData.description] - Description text.
     * @param {string} [initialData.color] - Hex color.
     * @param {string|null} [initialData.typeNodeId] - Type assignment for the defining prototype.
     * @returns {string} The new graph ID.
     */
    createNewGraph: (initialData = {}) => {
      const newGraphId = initialData.id || uuidv4(); // Use provided ID if available
      set(produce((draft) => {
        console.log('[Store createNewGraph] Creating new empty graph with ID:', newGraphId);
        const newGraphName = initialData.name || "New Thing";

        // Create a new prototype that will define this graph.
        const definingPrototypeId = uuidv4();
        const definingPrototypeData = {
          id: definingPrototypeId,
          name: newGraphName,
          description: initialData.description || '',
          color: initialData.color || NODE_DEFAULT_COLOR,
          typeNodeId: initialData.typeNodeId || null, // Node that serves as this node's type
          // No positional data in prototype
          definitionGraphIds: [newGraphId], // This prototype defines the new graph
          createdAt: new Date().toISOString()
        };
        draft.nodePrototypes.set(definingPrototypeId, definingPrototypeData);

        // Create a new empty graph
        const newGraphData = {
          id: newGraphId,
          name: newGraphName,
          description: initialData.description || '',
          picture: initialData.picture || null,
          color: initialData.color || NODE_DEFAULT_COLOR,
          directed: initialData.directed !== undefined ? initialData.directed : false,
          instances: new Map(), // Initialize with empty instances map
          groups: new Map(), // Map of groupId to group data
          edgeIds: [],
          definingNodeIds: [definingPrototypeId], // This graph is defined by the new prototype
          panOffset: null,
          zoomLevel: null,
        };
        draft.graphs.set(newGraphId, newGraphData);

        // Set active state
        draft.activeGraphId = newGraphId;
        draft.activeDefinitionNodeId = definingPrototypeId; // The defining prototype ID

        // Manage open/expanded lists
        if (!draft.openGraphIds.includes(newGraphId)) {
          draft.openGraphIds.unshift(newGraphId);
        }
        draft.expandedGraphIds.add(newGraphId);

        // Save the defining node by default
        draft.savedNodeIds.add(definingPrototypeId);
        // Ensure reference change for persistence
        draft.savedNodeIds = new Set(draft.savedNodeIds);

        console.log(`[Store] Created and activated new empty graph: ${newGraphId} ('${newGraphName}') defined by prototype ${definingPrototypeId}.`);
      }));
      return newGraphId; // Return the actual graph ID that was created
    },

    /**
     * Creates a graph with a specific ID, or no-ops if that ID already exists.
     *
     * Used when a deterministic ID is needed (e.g., wizard tools that predict IDs).
     * Activates the new graph and adds it to the open tab list.
     *
     * @param {string} graphId - Specific UUID to use for the new graph.
     * @param {Object} [initialData] - Same shape as `createNewGraph` initial data.
     */
    createGraphWithId: (graphId, initialData = {}) => set(produce((draft) => {
      if (!graphId) return;
      if (draft.graphs.has(graphId)) return;
      const name = initialData.name || 'New Graph';
      const definingPrototypeId = uuidv4();
      draft.nodePrototypes.set(definingPrototypeId, {
        id: definingPrototypeId,
        name,
        description: initialData.description || '',
        color: initialData.color || NODE_DEFAULT_COLOR,
        typeNodeId: initialData.typeNodeId || null,
        definitionGraphIds: [graphId],
        createdAt: new Date().toISOString()
      });
      const newGraphData = {
        id: graphId,
        name,
        description: initialData.description || '',
        picture: initialData.picture || null,
        color: initialData.color || NODE_DEFAULT_COLOR,
        directed: initialData.directed !== undefined ? initialData.directed : false,
        instances: new Map(),
        groups: new Map(),
        edgeIds: [],
        definingNodeIds: [definingPrototypeId],
        panOffset: null,
        zoomLevel: null,
      };
      draft.graphs.set(graphId, newGraphData);
      if (!draft.openGraphIds.includes(graphId)) {
        draft.openGraphIds.unshift(graphId);
      }
      draft.expandedGraphIds.add(graphId);
      draft.activeGraphId = graphId;
      console.log(`[Store createGraphWithId] Created and activated graph ${graphId} ('${name}')`);
    })),

    /**
     * Re-syncs bidirectional links between graphs and their defining prototypes.
     *
     * Walks all graphs and ensures each `definingNodeIds` entry has a matching
     * `definitionGraphIds` entry in the referenced prototype. Run this to recover
     * from data corruption or mismatched state after a partial import.
     */
    repairGraphLinkages: () => {
      console.log('[Repair Tool] Starting bidirectional link repair...');
      set(produce((draft) => {
        let repairCount = 0;

        // Iterate all graphs
        for (const [graphId, graph] of draft.graphs.entries()) {
          // Check if graph defines any nodes
          const definingNodeIds = graph.definingNodeIds || [];

          definingNodeIds.forEach(prototypeId => {
            const prototype = draft.nodePrototypes.get(prototypeId);
            if (!prototype) {
              console.warn(`[Repair Tool] Graph "${graph.name}" (${graphId}) defines missing prototype ${prototypeId}`);
              return;
            }

            // Ensure prototype links back to this graph
            if (!Array.isArray(prototype.definitionGraphIds)) {
              prototype.definitionGraphIds = [];
            }

            if (!prototype.definitionGraphIds.includes(graphId)) {
              prototype.definitionGraphIds.push(graphId);
              console.log(`[Repair Tool] 🛠️ FIXED: Linked Node "${prototype.name}" back to definition Graph "${graph.name}"`);
              repairCount++;
            }
          });
        }

        if (repairCount > 0) {
          console.log(`[Repair Tool] ✅ Completed with ${repairCount} repairs.`);
          // Force a store update trigger if needed, though Immer should handle it
        } else {
          console.log('[Repair Tool] No broken links found.');
        }
      }));
    },

    /**
     * Creates a new graph assigned as a definition to a prototype, and activates it.
     *
     * The new graph is added to `prototype.definitionGraphIds`, opened as a tab,
     * and set as the active graph. Returns the new graph ID.
     *
     * @param {string} prototypeId - Prototype that will own the new definition graph.
     * @returns {string|null} The new graph ID, or null if the prototype was not found.
     */
    createAndAssignGraphDefinition: (prototypeId) => {
      let newGraphId = null;
      set(produce((draft) => {
        newGraphId = _createAndAssignGraphDefinition(draft, prototypeId);
        if (!newGraphId) return;

        // Open and activate the new graph (add to TOP of list)
        if (!draft.openGraphIds.includes(newGraphId)) {
          draft.openGraphIds.unshift(newGraphId);
        }
        draft.activeGraphId = newGraphId;
        draft.activeDefinitionNodeId = prototypeId;

        // Auto-expand the new graph in the "Open Things" list
        draft.expandedGraphIds.add(newGraphId);

        console.log(`[Store createAndAssignGraphDefinition] Created new graph ${newGraphId} for prototype ${prototypeId}, set as active, and auto-expanded.`);
      }));
      return newGraphId;
    },

    /**
     * Creates a new graph assigned as a definition to a prototype, without activating it.
     *
     * Same as `createAndAssignGraphDefinition` but leaves `activeGraphId` unchanged.
     * Use this when building definition graphs in the background.
     *
     * @param {string} prototypeId - Prototype that will own the new definition graph.
     * @returns {string|null} The new graph ID, or null if the prototype was not found.
     */
    createAndAssignGraphDefinitionWithoutActivation: (prototypeId) => {
      let newGraphId = null;
      set(produce((draft) => {
        newGraphId = _createAndAssignGraphDefinition(draft, prototypeId);
        if (!newGraphId) return;

        console.log(`[Store createAndAssignGraphDefinitionWithoutActivation] Created new graph ${newGraphId} for prototype ${prototypeId}.`);
      }));
      return newGraphId;
    },

    /**
     * Creates a definition graph with a specific ID and assigns it to a prototype.
     *
     * Does NOT change `activeGraphId`. If the graph already exists, opens its tab
     * without re-creating it. Used by wizard tools that generate predictive IDs to
     * avoid UUID mismatch between AgentLoop predictions and real store IDs.
     *
     * @param {string} graphId - Specific UUID to use for the new definition graph.
     * @param {string} prototypeId - Prototype that will own this definition graph.
     */
    createDefinitionGraphWithId: (graphId, prototypeId) => {
      set(produce((draft) => {
        const prototype = draft.nodePrototypes.get(prototypeId);
        if (!prototype) {
          console.error(`[Store createDefinitionGraphWithId] Prototype ${prototypeId} not found.`);
          return;
        }
        if (draft.graphs.has(graphId)) {
          console.log(`[Store createDefinitionGraphWithId] Graph ${graphId} already exists. Ensuring it is open.`);
          if (!draft.openGraphIds.includes(graphId)) {
            draft.openGraphIds.unshift(graphId);
          }
          draft.expandedGraphIds.add(graphId);
          return;
        }
        const newGraphData = {
          id: graphId,
          name: prototype.name || 'New Thing',
          description: '',
          picture: null,
          color: prototype.color || NODE_DEFAULT_COLOR,
          directed: true,
          instances: new Map(),
          groups: new Map(),
          edgeIds: [],
          definingNodeIds: [prototypeId],
        };
        draft.graphs.set(graphId, newGraphData);
        if (!Array.isArray(prototype.definitionGraphIds)) {
          prototype.definitionGraphIds = [];
        }
        prototype.definitionGraphIds.push(graphId);
        // Open the tab but don't change activeGraphId
        if (!draft.openGraphIds.includes(graphId)) {
          draft.openGraphIds.unshift(graphId);
        }
        draft.expandedGraphIds.add(graphId);
        console.log(`[Store createDefinitionGraphWithId] Created graph ${graphId} for prototype ${prototypeId} (${prototype.name}).`);
      }));
    },

    /**
     * Finds a node prototype by name (case-insensitive, trims whitespace).
     * Returns the first match. Does not modify state.
     *
     * @param {string} name - Name to search for.
     * @returns {NodePrototype|undefined} The matching prototype, or undefined if not found.
     */
    findPrototypeByName: (name) => {
      const state = get();
      const searchName = name.toLowerCase().trim();

      return Array.from(state.nodePrototypes.values())
        .find(proto => proto.name?.toLowerCase().trim() === searchName);
    },

    /**
     * High-level helper for creating a concept prototype with an optional definition graph
     * pre-populated with sub-concepts and relationships.
     *
     * Creates: (1) a prototype for the concept, (2) a definition graph if `subConcepts`
     * are provided, (3) prototype+instance for each sub-concept inside that graph,
     * (4) edges for each relationship, (5) optionally, an instance in `targetGraphId`.
     *
     * @param {Object} conceptData
     * @param {string} conceptData.name - Name for the main concept.
     * @param {string} [conceptData.color] - Hex color.
     * @param {string} [conceptData.description] - Description text.
     * @param {Array<{name: string, color?: string, description?: string}>} [conceptData.subConcepts=[]]
     * @param {Array<{source: string, target: string, type?: string}>} [conceptData.relationships=[]]
     * @param {string|null} [conceptData.targetGraphId=null] - Graph to place the main concept instance in.
     * @returns {{prototypeId: string, definitionGraphId: string|null, instanceId: string|null, subConceptIds: Array, edgeIds: string[]}}
     */
    createComplexConcept: (conceptData) => {
      const {
        name,
        color,
        description,
        subConcepts = [], // Array of { name, color?, description? }
        relationships = [], // Array of { source, target, type? }
        targetGraphId = null, // Where to add the main concept instance
        addToSemanticMemory = false // Whether to track in Druid's semantic memory
      } = conceptData;

      let result = {
        prototypeId: null,
        definitionGraphId: null,
        instanceId: null,
        subConceptIds: [],
        edgeIds: []
      };

      set(produce((draft) => {
        // 1. Create prototype for main concept
        const prototypeId = uuidv4();
        draft.nodePrototypes.set(prototypeId, {
          id: prototypeId,
          name,
          description: description || '',
          color: color || NODE_DEFAULT_COLOR,
          definitionGraphIds: [],
          createdAt: new Date().toISOString()
        });
        result.prototypeId = prototypeId;

        // 2. Create definition graph for it (if it's complex with sub-concepts)
        if (subConcepts.length > 0) {
          const defGraphId = _createAndAssignGraphDefinition(draft, prototypeId);
          result.definitionGraphId = defGraphId;

          const defGraph = draft.graphs.get(defGraphId);
          if (defGraph) {
            defGraph.name = `${name} Definition`;
            defGraph.description = `Defining components of ${name}`;

            // 3. Create prototypes and instances for sub-concepts
            subConcepts.forEach((subConcept, index) => {
              const subProtoId = uuidv4();
              draft.nodePrototypes.set(subProtoId, {
                id: subProtoId,
                name: subConcept.name,
                description: subConcept.description || '',
                color: subConcept.color || NODE_DEFAULT_COLOR,
                definitionGraphIds: [],
                createdAt: new Date().toISOString()
              });

              // Add instance to definition graph
              const subInstanceId = uuidv4();
              defGraph.instances.set(subInstanceId, {
                id: subInstanceId,
                prototypeId: subProtoId,
                x: (index % 3) * 200, // Simple grid layout
                y: Math.floor(index / 3) * 200,
                scale: 1
              });

              result.subConceptIds.push({
                prototypeId: subProtoId,
                instanceId: subInstanceId,
                name: subConcept.name
              });
            });

            // 4. Create edges for relationships
            relationships.forEach(rel => {
              const sourceSubConcept = result.subConceptIds.find(sc => sc.name === rel.source);
              const targetSubConcept = result.subConceptIds.find(sc => sc.name === rel.target);

              if (sourceSubConcept && targetSubConcept) {
                const edgeId = uuidv4();
                const edgeData = {
                  id: edgeId,
                  sourceId: sourceSubConcept.instanceId,
                  destinationId: targetSubConcept.instanceId,
                  typeNodeId: null,
                  name: rel.type || 'related to',
                  directionality: {
                    arrowsToward: new Set([targetSubConcept.instanceId])
                  }
                };

                draft.edges.set(edgeId, edgeData);
                defGraph.edgeIds.push(edgeId);
                result.edgeIds.push(edgeId);
              }
            });
          }
        }

        // 5. Optionally add instance to target graph
        if (targetGraphId && draft.graphs.has(targetGraphId)) {
          const instanceId = uuidv4();
          const targetGraph = draft.graphs.get(targetGraphId);
          targetGraph.instances.set(instanceId, {
            id: instanceId,
            prototypeId: prototypeId,
            x: Math.random() * 400, // Random position for now
            y: Math.random() * 300,
            scale: 1
          });
          result.instanceId = instanceId;
        }

        console.log(`[Store createComplexConcept] Created complex concept "${name}" with ${subConcepts.length} sub-concepts`);
      }));

      return result;
    },

    // ─── ACTIVE GRAPH & RIGHT PANEL ──────────────────────────────────────────────

    /**
     * Sets the active graph, automatically determining the `activeDefinitionNodeId`
     * from the graph's `definingNodeIds[0]`.
     *
     * Falls back to the first open graph if `graphId` is invalid or not open.
     *
     * @param {string} graphId - ID of the graph to activate.
     */
    setActiveGraph: (graphId) => {
      console.log(`[Store Action] setActiveGraph called with: ${graphId}`);
      set((state) => {
        const targetGraph = state.graphs.get(graphId);

        // Check if the graph exists and is open
        if (targetGraph && state.openGraphIds.includes(graphId)) {
          console.log(`[Store Action] Setting active graph: ${graphId}`);
          // Determine the corresponding activeDefinitionNodeId
          const newActiveDefinitionNodeId = targetGraph.definingNodeIds?.[0] || null;
          console.log(`[Store Action] Setting activeDefinitionNodeId to: ${newActiveDefinitionNodeId}`);
          return {
            activeGraphId: graphId,
            activeDefinitionNodeId: newActiveDefinitionNodeId
          };
        } else {
          console.warn(`[Store Action] setActiveGraph: Graph ID ${graphId} not found or not open.`);
          // Fallback: Activate the first open graph if the target isn't valid
          if (state.openGraphIds.length > 0) {
            const fallbackGraphId = state.openGraphIds[0];
            const fallbackGraph = state.graphs.get(fallbackGraphId);
            const fallbackDefNodeId = fallbackGraph?.definingNodeIds?.[0] || null;
            console.log(`[Store Action] Fallback: Setting active graph to ${fallbackGraphId} and def node to ${fallbackDefNodeId}`);
            return {
              activeGraphId: fallbackGraphId,
              activeDefinitionNodeId: fallbackDefNodeId
            };
          } else {
            console.log(`[Store Action] Fallback: No graphs open, setting activeGraphId and activeDefinitionNodeId to null.`);
            return { activeGraphId: null, activeDefinitionNodeId: null }; // No graphs open
          }
        }
      });
    },

    /**
     * Updates graph properties using an Immer recipe function.
     *
     * Automatically syncs any name change to the graph's defining prototype(s) and to
     * open right-panel tab titles.
     *
     * @param {string} graphId - ID of the graph to update.
     * @param {function} updateFn - Immer recipe: `(graph) => { graph.name = '...'; }`.
     */
    updateGraph: (graphId, updateFn) => {
      api.setChangeContext({ type: 'graph_update', target: 'graph', graphId });
      return set(produce((draft) => {
        const graphData = draft.graphs.get(graphId);
        if (graphData) {
          const originalName = graphData.name; // Store original name
          // Apply the update function directly to the draft state
          updateFn(graphData);
          // Immer will handle the update, no need to set it back manually

          // Check if the name was changed
          const newName = graphData.name;
          if (newName !== originalName) {
            console.log(`[Store updateGraph] Graph ${graphId} name changed from "${originalName}" to "${newName}". Syncing defining node name.`);
            // Find the corresponding definition prototype(s) and update their names
            for (const prototype of draft.nodePrototypes.values()) {
              if (Array.isArray(prototype.definitionGraphIds) && prototype.definitionGraphIds.includes(graphId)) {
                console.log(`[Store updateGraph] Updating prototype ${prototype.id} name to match graph.`);
                prototype.name = newName;
                // Also update the node's tab title if it's open in the right panel
                const tabIndex = draft.rightPanelTabs.findIndex(tab => tab.nodeId === prototype.id);
                if (tabIndex !== -1) {
                  draft.rightPanelTabs[tabIndex].title = newName;
                }
              }
            }
          }
        } else {
          console.warn(`updateGraph: Graph ${graphId} not found.`);
        }
      }));
    },

    // ─── RIGHT PANEL TAB MANAGEMENT ──────────────────────────────────────────────

    /**
     * Opens or activates a node tab in the right panel for the given prototype.
     *
     * If a tab for this node already exists, activates it. Otherwise appends a new tab.
     * All other tabs are deactivated. Also ensures the right panel is expanded so the
     * navigated-to node is visible.
     *
     * @param {string} nodeId - Prototype ID to open in the panel.
     * @param {string} [nodeNameFallback='Node Details'] - Tab title fallback if prototype name is absent.
     */
    openRightPanelNodeTab: (nodeId, nodeNameFallback = 'Node Details') => set(produce((draft) => {
      // Find prototype data to get the title
      const prototypeData = draft.nodePrototypes.get(nodeId);
      if (!prototypeData) {
        console.warn(`openRightPanelNodeTab: Node prototype with id ${nodeId} not found.`);
        return;
      }

      // Check if tab already exists
      const existingTabIndex = draft.rightPanelTabs.findIndex(tab =>
        tab.type === 'node' && tab.nodeId === nodeId
      );

      // Set all tabs to inactive
      draft.rightPanelTabs.forEach(tab => { tab.isActive = false; });

      if (existingTabIndex > -1) {
        // Tab exists, just activate it
        draft.rightPanelTabs[existingTabIndex].isActive = true;
      } else {
        // Create new tab
        draft.rightPanelTabs.push({
          type: 'node',
          nodeId,
          title: prototypeData.name || nodeNameFallback,
          isActive: true
        });
      }

      // Ensure the right panel is open so the navigated-to node is visible.
      // Centralizes the "open panel on double-click navigation" behavior for
      // all call sites (carousel, canvas nodes, panel lists, etc.).
      draft.rightPanelExpanded = true;
    })),

    /**
     * Activates a right panel tab by its zero-based index.
     * All other tabs are deactivated.
     *
     * @param {number} index - Index into `rightPanelTabs`.
     */
    activateRightPanelTab: (index) => set(produce((draft) => {
      if (index < 0 || index >= draft.rightPanelTabs.length) {
        console.warn(`activateRightPanelTab: Tab index ${index} out of bounds.`);
        return;
      }

      // Set all tabs to inactive, then activate the selected tab
      draft.rightPanelTabs.forEach(tab => { tab.isActive = false; });
      draft.rightPanelTabs[index].isActive = true;
    })),

    /**
     * Removes a node tab from the right panel. The home tab (index 0) is never removed.
     * If the closed tab was active, activates the home tab.
     *
     * @param {string} nodeIdToClose - Prototype ID of the tab to close.
     */
    closeRightPanelTab: (nodeIdToClose) => set(produce((draft) => {
      // Find the index of the tab with the matching nodeId
      const index = draft.rightPanelTabs.findIndex(tab => tab.nodeId === nodeIdToClose);

      // Check if found and it's not the home tab (index 0)
      if (index === -1 || index === 0) {
        console.warn(`closeRightPanelTab: Tab with node ID ${nodeIdToClose} not found or is home tab.`);
        return;
      }

      const wasActive = draft.rightPanelTabs[index].isActive;

      // Remove the tab
      draft.rightPanelTabs.splice(index, 1);

      // If the closed tab was active, activate the home tab
      if (wasActive && draft.rightPanelTabs.length > 0) {
        draft.rightPanelTabs[0].isActive = true;
      }
    })),

    /**
     * Reorders right panel tabs via drag-and-drop.
     * Indices are 0-based from the drag layer (the home tab at position 0 is excluded).
     *
     * @param {number} dragIndex - Source position (0-based, excluding home tab).
     * @param {number} hoverIndex - Target position (0-based, excluding home tab).
     */
    moveRightPanelTab: (dragIndex, hoverIndex) => set(produce((draft) => {
      // Convert to absolute indices (drag and hover are 0-based from the UI but we need to add 1 for the home tab)
      const sourceDragIndex = dragIndex + 1;
      const sourceHoverIndex = hoverIndex + 1;

      if (sourceDragIndex <= 0 || sourceHoverIndex <= 0 ||
        sourceDragIndex >= draft.rightPanelTabs.length || sourceHoverIndex >= draft.rightPanelTabs.length) {
        console.warn(`moveRightPanelTab: Invalid indices drag=${sourceDragIndex}, hover=${sourceHoverIndex}`);
        return;
      }

      // Move the tab
      const [movedTab] = draft.rightPanelTabs.splice(sourceDragIndex, 1);
      draft.rightPanelTabs.splice(sourceHoverIndex, 0, movedTab);
    })),

    /**
     * Closes a graph tab and removes it from the open list.
     * If it was the active graph, activates the nearest remaining open graph.
     * Schedules `cleanupOrphanedData` 100ms after close.
     *
     * @param {string} graphId - ID of the graph to close.
     */
    closeGraph: (graphId) => set(produce((draft) => {
      console.log(`[Store closeGraph] Called with graphId: ${graphId}`);
      const index = draft.openGraphIds.indexOf(graphId);
      if (index === -1) {
        console.warn(`[Store closeGraph] Graph ID ${graphId} not found in openGraphIds.`);
        return; // Graph not open, nothing to close
      }

      const wasActive = draft.activeGraphId === graphId;
      let newActiveId = draft.activeGraphId;

      // Remove the graph ID from the list
      draft.openGraphIds.splice(index, 1);

      // Determine the new active graph ONLY if the closed one was active
      if (wasActive) {
        if (draft.openGraphIds.length === 0) {
          // No graphs left
          newActiveId = null;
        } else if (index > 0) {
          // There was a graph above the closed one, try to activate it
          // Note: The index before splicing corresponds to the item now *at* index-1
          newActiveId = draft.openGraphIds[index - 1];
        } else {
          // Closed the first graph (index 0), activate the new first graph
          newActiveId = draft.openGraphIds[0];
        }
      }

      // Set the new active ID
      draft.activeGraphId = newActiveId;
      if (draft.activeGraphId === null) {
        console.log('[Store closeGraph] Active graph became null, setting activeDefinitionNodeId to null');
        draft.activeDefinitionNodeId = null;
      }

      // <<< Also remove from expanded set if closed >>>
      draft.expandedGraphIds.delete(graphId);

      // Schedule cleanup after closing a graph
      console.log(`[Store closeGraph] Graph ${graphId} closed, scheduling cleanup...`);
      setTimeout(() => {
        const currentState = get();
        currentState.cleanupOrphanedData();
      }, 100);
    })),

    // ─── SAVED & EXPANDED STATE ──────────────────────────────────────────────────

    /**
     * Toggles whether a graph node is expanded in the "Open Things" left panel list.
     * @param {string} graphId
     */
    toggleGraphExpanded: (graphId) => set(produce((draft) => {
      console.log(`[Store toggleGraphExpanded] Called for ${graphId}. Current state:`, new Set(draft.expandedGraphIds)); // <<< Log entry
      if (draft.expandedGraphIds.has(graphId)) {
        draft.expandedGraphIds.delete(graphId);
        console.log(`[Store toggleGraphExpanded] Removed ${graphId}. New state:`, new Set(draft.expandedGraphIds)); // <<< Log after delete
      } else {
        draft.expandedGraphIds.add(graphId);
        console.log(`[Store toggleGraphExpanded] Added ${graphId}. New state:`, new Set(draft.expandedGraphIds)); // <<< Log after add
      }
    })),

    /**
     * Toggles a node prototype's pinned status in the right panel.
     *
     * Removing a saved node schedules `cleanupOrphanedData` 100ms later to purge
     * any now-orphaned prototypes.
     *
     * @param {string} nodeId - Prototype ID to pin/unpin.
     */
    toggleSavedNode: (nodeId) => set(produce((draft) => {
      const wasRemoved = draft.savedNodeIds.has(nodeId);
      if (wasRemoved) {
        draft.savedNodeIds.delete(nodeId);
      } else {
        draft.savedNodeIds.add(nodeId);
      }
      // Replace with a new Set instance to ensure reference change
      draft.savedNodeIds = new Set(draft.savedNodeIds);

      // If we removed a saved node, trigger cleanup after a short delay
      if (wasRemoved) {
        console.log(`[Store toggleSavedNode] Node ${nodeId} was unsaved, scheduling cleanup...`);
        // Use setTimeout to trigger cleanup after the current state update completes
        setTimeout(() => {
          const currentState = get();
          currentState.cleanupOrphanedData();
        }, 100);
      }
    })),

    /**
     * Toggles a graph's bookmarked status by pinning/unpinning its defining prototype.
     *
     * If the graph has no defining prototype, creates one automatically. Toggling
     * operates on `savedNodeIds` via the defining prototype ID.
     *
     * @param {string} graphId - ID of the graph to bookmark/unbookmark.
     */
    toggleSavedGraph: (graphId) => set(produce((draft) => {
      const graph = draft.graphs.get(graphId);
      if (!graph) {
        console.warn(`[Store toggleSavedGraph] Graph ${graphId} not found.`);
        return;
      }

      // Get the defining node ID (the node this graph defines)
      let definingNodeId = graph.definingNodeIds?.[0];

      // If no defining node exists, create one to represent this graph
      if (!definingNodeId) {
        console.log(`[Store toggleSavedGraph] Graph ${graphId} has no defining node. Creating one.`);

        // Create a new node to represent this graph
        definingNodeId = uuidv4();
        const definingNodeData = {
          id: definingNodeId,
          name: graph.name || 'New Thing',
          description: graph.description || '',
          picture: '',
          color: NODE_DEFAULT_COLOR,
          // No positional data in prototype
          definitionGraphIds: [graphId], // This node defines the current graph
          createdAt: new Date().toISOString()
        };

        // Add the defining node to the nodes map
        draft.nodePrototypes.set(definingNodeId, definingNodeData);

        // Set this node as the defining node for the graph
        if (!graph.definingNodeIds) {
          graph.definingNodeIds = [];
        }
        graph.definingNodeIds.unshift(definingNodeId); // Add to beginning

        console.log(`[Store toggleSavedGraph] Created defining node ${definingNodeId} for graph ${graphId}.`);
      }

      const wasNodeSaved = draft.savedNodeIds.has(definingNodeId);
      if (wasNodeSaved) {
        draft.savedNodeIds.delete(definingNodeId);
        console.log(`[Store toggleSavedGraph] Removed defining node ${definingNodeId} from saved nodes (bookmarked graph ${graphId}).`);
      } else {
        draft.savedNodeIds.add(definingNodeId);
        console.log(`[Store toggleSavedGraph] Added defining node ${definingNodeId} to saved nodes (bookmarked graph ${graphId}).`);
      }
      // Replace with a new Set instance to ensure reference change
      draft.savedNodeIds = new Set(draft.savedNodeIds);
    })),

    // ─── DISPLAY SETTINGS ────────────────────────────────────────────────────────

    /**
     * Sets the scale multiplier for connection label text. Persists to localStorage.
     * @param {number} size - Multiplier (e.g., 1.0 = default size).
     */
    setConnectionLabelSize: (size) => set(produce((draft) => {
      draft.connectionLabelSize = size;
      try {
        localStorage.setItem('redstring_connection_label_size', size);
      } catch (_) { }
    })),

    /** Toggles visibility of connection labels on the canvas. Persists to localStorage. */
    toggleShowConnectionNames: () => set(produce((draft) => {
      draft.showConnectionNames = !draft.showConnectionNames;
      try {
        localStorage.setItem('redstring_show_connection_names', draft.showConnectionNames);
      } catch (_) { }
    })),
    /** Toggles directional glow effects on edges. Persists to localStorage. */
    toggleShowEdgeGlowIndicators: () => set(produce((draft) => {
      draft.showEdgeGlowIndicators = !draft.showEdgeGlowIndicators;
      try {
        localStorage.setItem('redstring_show_edge_glow', draft.showEdgeGlowIndicators);
      } catch (_) { }
    })),
    /** Toggles the hover-preview card shown when hovering over a node. Persists to localStorage. */
    toggleShowHoverPreview: () => set(produce((draft) => {
      draft.showHoverPreview = !draft.showHoverPreview;
      try {
        localStorage.setItem('redstring_show_hover_preview', draft.showHoverPreview);
      } catch (_) { }
    })),
    /** Toggles the single-node control panel. Persists to localStorage. */
    toggleShowNodeControlPanel: () => set(produce((draft) => {
      draft.showNodeControlPanel = !draft.showNodeControlPanel;
      try { localStorage.setItem('redstring_show_node_cp', draft.showNodeControlPanel); } catch (_) { }
    })),
    /** Toggles the multi-node selection control panel. Persists to localStorage. */
    toggleShowMultipleNodesControlPanel: () => set(produce((draft) => {
      draft.showMultipleNodesControlPanel = !draft.showMultipleNodesControlPanel;
      try { localStorage.setItem('redstring_show_multi_node_cp', draft.showMultipleNodesControlPanel); } catch (_) { }
    })),
    /** Toggles the connection (edge) control panel. Persists to localStorage. */
    toggleShowConnectionControlPanel: () => set(produce((draft) => {
      draft.showConnectionControlPanel = !draft.showConnectionControlPanel;
      try { localStorage.setItem('redstring_show_connection_cp', draft.showConnectionControlPanel); } catch (_) { }
    })),
    /** Toggles the group control panel. Persists to localStorage. */
    toggleShowGroupControlPanel: () => set(produce((draft) => {
      draft.showGroupControlPanel = !draft.showGroupControlPanel;
      try { localStorage.setItem('redstring_show_group_cp', draft.showGroupControlPanel); } catch (_) { }
    })),
    /** Toggles the abstraction chain control panel. Persists to localStorage. */
    toggleShowAbstractionControlPanel: () => set(produce((draft) => {
      draft.showAbstractionControlPanel = !draft.showAbstractionControlPanel;
      try { localStorage.setItem('redstring_show_abstraction_cp', draft.showAbstractionControlPanel); } catch (_) { }
    })),
    /**
     * Sets the hover preview card scale multiplier. Clamped to [0.5, 1.5]. Persists to localStorage.
     * @param {number} value
     */
    setHoverPreviewSize: (value) => set(produce((draft) => {
      const v = Number(value);
      if (!Number.isFinite(v)) {
        console.warn(`[setHoverPreviewSize] Invalid value: ${value}`);
        return;
      }
      const clamped = Math.max(0.5, Math.min(1.5, v));
      draft.hoverPreviewSize = clamped;
      try {
        localStorage.setItem('redstring_hover_preview_size', String(clamped));
      } catch (_) { }
    })),
    /**
     * Toggles dark mode. Persists to localStorage and syncs to workspace config if available.
     */
    toggleDarkMode: () => {
      set(produce((draft) => {
        draft.darkMode = !draft.darkMode;
        try {
          localStorage.setItem('redstring_dark_mode', draft.darkMode);
        } catch (_) { }
      }));

      // Also save to workspace config if available
      if (typeof window !== 'undefined' && window.__workspaceService) {
        window.__workspaceService.setUISettings({ darkMode: useGraphStore.getState().darkMode }).catch(err => {
          console.warn('[toggleDarkMode] Failed to save to workspace config:', err);
        });
      }
    },

    // ─── INPUT & LAYOUT SETTINGS ─────────────────────────────────────────────────

    /**
     * Loads UI settings (currently just darkMode) from a workspace config service.
     * Stores the service reference on `window.__workspaceService` for future saves.
     *
     * @param {Object} workspaceService - Service with a `getUISettings()` method.
     */
    loadUISettingsFromWorkspace: async (workspaceService) => {
      try {
        const uiSettings = workspaceService.getUISettings();
        if (uiSettings.darkMode !== undefined) {
          set(produce((draft) => {
            draft.darkMode = uiSettings.darkMode;
            try {
              localStorage.setItem('redstring_dark_mode', draft.darkMode);
            } catch (_) { }
          }));
        }
        // Store reference for future saves
        if (typeof window !== 'undefined') {
          window.__workspaceService = workspaceService;
        }
      } catch (err) {
        console.warn('[loadUISettingsFromWorkspace] Failed:', err);
      }
    },

    /**
     * Sets the active input modality. No-ops when value is unchanged to avoid spurious re-renders.
     * Flipped automatically by the pointerdown handler in NodeCanvas based on `PointerEvent.pointerType`.
     *
     * @param {'mouse'|'touch'} mode
     */
    setInputMode: (mode) => {
      if (mode !== 'mouse' && mode !== 'touch') return;
      if (get().inputMode === mode) return;
      set(produce((draft) => { draft.inputMode = mode; }));
    },

    /**
     * Sets the grid visualization mode. Persists to localStorage.
     * @param {'off'|'hover'|'always'} mode
     */
    setGridMode: (mode) => set(produce((draft) => {
      const allowed = ['off', 'hover', 'always'];
      if (!draft.gridSettings) draft.gridSettings = { mode: 'off', size: 200 };
      if (allowed.includes(mode)) {
        draft.gridSettings.mode = mode;
        try { localStorage.setItem('redstring_grid_mode', mode); } catch (_) { }
      } else {
        console.warn(`[setGridMode] Invalid mode: ${mode}`);
      }
    })),
    /**
     * Sets the grid cell size in canvas pixels. Clamped to [20, 400]. Persists to localStorage.
     * @param {number} value
     */
    setGridSize: (value) => set(produce((draft) => {
      if (!draft.gridSettings) draft.gridSettings = { mode: 'off', size: 200 };
      const v = Number(value);
      if (!Number.isFinite(v)) {
        console.warn(`[setGridSize] Invalid value: ${value}`);
        return;
      }
      const clamped = Math.max(20, Math.min(400, Math.round(v)));
      draft.gridSettings.size = clamped;
      try { localStorage.setItem('redstring_grid_size', String(clamped)); } catch (_) { }
    })),
    /**
     * Sets when auto-layout (and other bulk placement) should snap nodes to the grid.
     * `'if-enabled'` snaps only when the grid mode isn't off; `'always'` always snaps;
     * `'never'` disables snapping. Persists to localStorage.
     * @param {'if-enabled'|'always'|'never'} mode
     */
    setGridSnapMode: (mode) => set(produce((draft) => {
      const allowed = ['if-enabled', 'always', 'never'];
      if (!draft.gridSettings) draft.gridSettings = { mode: 'off', size: 200, snapMode: 'if-enabled' };
      if (allowed.includes(mode)) {
        draft.gridSettings.snapMode = mode;
        try { localStorage.setItem('redstring_grid_snap', mode); } catch (_) { }
      } else {
        console.warn(`[setGridSnapMode] Invalid mode: ${mode}`);
      }
    })),
    /**
     * Sets the grid's visual appearance when the grid is drawn: `'lattice'` renders
     * intersecting lines, `'dot'` renders dots at each vertex (the same dots shown
     * while dragging). Persists to localStorage.
     * @param {'lattice'|'dot'} appearance
     */
    setGridAppearance: (appearance) => set(produce((draft) => {
      const allowed = ['lattice', 'dot'];
      if (!draft.gridSettings) draft.gridSettings = { mode: 'off', size: 200, snapMode: 'if-enabled', appearance: 'lattice' };
      if (allowed.includes(appearance)) {
        draft.gridSettings.appearance = appearance;
        try { localStorage.setItem('redstring_grid_appearance', appearance); } catch (_) { }
      } else {
        console.warn(`[setGridAppearance] Invalid appearance: ${appearance}`);
      }
    })),

    /** Toggles drag-to-zoom (pinch/scroll zoom on drag). Persists to localStorage. */
    toggleDragZoomEnabled: () => set(produce((draft) => {
      if (!draft.dragZoomSettings) {
        draft.dragZoomSettings = { enabled: true, zoomAmount: 0.45 };
      }
      draft.dragZoomSettings.enabled = !draft.dragZoomSettings.enabled;
      try {
        localStorage.setItem('redstring_drag_zoom_enabled', String(draft.dragZoomSettings.enabled));
      } catch (_) { }
    })),

    /**
     * Sets how aggressively drag-zoom scales the view. Clamped to [0, 0.9]. Persists to localStorage.
     * @param {number} value - 0 = no zoom, 0.9 = zoom out by 90%.
     */
    setDragZoomAmount: (value) => set(produce((draft) => {
      if (!draft.dragZoomSettings) {
        draft.dragZoomSettings = { enabled: true, zoomAmount: 0.45 };
      }
      const v = Number(value);
      if (!Number.isFinite(v)) {
        console.warn(`[setDragZoomAmount] Invalid value: ${value}`);
        return;
      }
      // Clamp between 0.0 (no zoom) and 0.9 (zoom out by 90%)
      const clamped = Math.max(0.0, Math.min(0.9, v));
      draft.dragZoomSettings.zoomAmount = clamped;
      try {
        localStorage.setItem('redstring_drag_zoom_amount', String(clamped));
      } catch (_) { }
    })),

    /** Toggles whether edge auto-routing avoids nodes. Persists to localStorage. */
    toggleEnableAutoRouting: () => set(produce((draft) => {
      if (!draft.autoLayoutSettings) {
        draft.autoLayoutSettings = getDefaultAutoLayoutSettings();
      }
      draft.autoLayoutSettings.enableAutoRouting = !draft.autoLayoutSettings.enableAutoRouting;
    })),

    /**
     * Sets the algorithm used to lay out node-groups.
     * @param {'node-driven'|string} algorithm
     */
    setGroupLayoutAlgorithm: (algorithm) => set(produce((draft) => {
      if (!draft.autoLayoutSettings) {
        draft.autoLayoutSettings = getDefaultAutoLayoutSettings();
      }
      draft.autoLayoutSettings.groupLayoutAlgorithm = algorithm;
      console.log(`[Store] Group layout algorithm set to: ${algorithm}`);
    })),

    /** Toggles debug cluster hull visualization. Persists to localStorage. */
    toggleShowClusterHulls: () => set(produce((draft) => {
      if (!draft.autoLayoutSettings) {
        draft.autoLayoutSettings = getDefaultAutoLayoutSettings();
      }
      draft.autoLayoutSettings.showClusterHulls = !draft.autoLayoutSettings.showClusterHulls;
      console.log(`[Store] Show cluster hulls set to: ${draft.autoLayoutSettings.showClusterHulls}`);
    })),

    /**
     * Sets the edge routing style.
     * @param {'straight'|'orthogonal'|string} style
     */
    setRoutingStyle: (style) => set(produce((draft) => {
      if (!draft.autoLayoutSettings) {
        draft.autoLayoutSettings = getDefaultAutoLayoutSettings();
      }
      if (style === 'straight' || style === 'manhattan' || style === 'clean') {
        draft.autoLayoutSettings.routingStyle = style;
      } else {
        console.warn(`[setRoutingStyle] Invalid routing style: ${style}`);
      }
    })),

    /**
     * Sets how Manhattan-style bends are applied to routed edges.
     * @param {'auto'|string} mode
     */
    setManhattanBends: (mode) => set(produce((draft) => {
      if (!draft.autoLayoutSettings) {
        draft.autoLayoutSettings = getDefaultAutoLayoutSettings();
      }
      if (mode === 'auto' || mode === 'one' || mode === 'two') {
        draft.autoLayoutSettings.manhattanBends = mode;
      } else {
        console.warn(`[setManhattanBends] Invalid bends mode: ${mode}`);
      }
    })),

    /**
     * Sets spacing between parallel edge lanes in canvas pixels. Persists to localStorage.
     * @param {number} value
     */
    setCleanLaneSpacing: (value) => set(produce((draft) => {
      if (!draft.autoLayoutSettings) {
        draft.autoLayoutSettings = getDefaultAutoLayoutSettings();
      }
      const v = Number(value);
      if (!Number.isFinite(v)) {
        console.warn(`[setCleanLaneSpacing] Invalid value: ${value}`);
        return;
      }
      // Clamp for sanity with new generous range
      const clamped = Math.max(100, Math.min(400, Math.round(v)));
      draft.autoLayoutSettings.cleanLaneSpacing = clamped;
    })),

    /**
     * Sets the curve multiplier for parallel (multi) connections. Persists to localStorage.
     * 1.0 = default bow-out distance.
     * @param {number} value
     */
    setMultiConnectionCurve: (value) => set(produce((draft) => {
      if (!draft.autoLayoutSettings) {
        draft.autoLayoutSettings = getDefaultAutoLayoutSettings();
      }
      const v = Number(value);
      if (!Number.isFinite(v)) {
        console.warn(`[setMultiConnectionCurve] Invalid value: ${value}`);
        return;
      }
      const clamped = Math.max(0, Math.min(3, v));
      draft.autoLayoutSettings.multiConnectionCurve = clamped;
      try {
        localStorage.setItem('redstring_multi_connection_curve_v2', String(clamped));
      } catch (_) { }
    })),

    /**
     * Sets font size multiplier for node label text. Persists to localStorage.
     * @param {number} value
     */
    setTextFontSize: (value) => set(produce((draft) => {
      const v = Number(value);
      if (!Number.isFinite(v) || v < 0.7 || v > 2.0) {
        console.warn(`[setTextFontSize] Invalid value: ${value}`);
        return;
      }
      draft.textSettings.fontSize = v;
      try {
        localStorage.setItem('redstring_text_font_size', String(v));
      } catch (_) { }
    })),

    /**
     * Sets line spacing multiplier for node label text. Persists to localStorage.
     * @param {number} value
     */
    setTextLineSpacing: (value) => set(produce((draft) => {
      const v = Number(value);
      if (!Number.isFinite(v) || v < 0.7 || v > 2.0) {
        console.warn(`[setTextLineSpacing] Invalid value: ${value}`);
        return;
      }
      draft.textSettings.lineSpacing = v;
      try {
        localStorage.setItem('redstring_text_line_spacing', String(v));
      } catch (_) { }
    })),

    /**
     * Sets the global node size scale multiplier. Persists to localStorage.
     * @param {number} value
     */
    setNodeScale: (value) => set(produce((draft) => {
      const v = Number(value);
      if (!Number.isFinite(v) || v < 0.5 || v > 2.0) {
        console.warn(`[setNodeScale] Invalid value: ${value}`);
        return;
      }
      draft.textSettings.nodeScale = v;
      try {
        localStorage.setItem('redstring_node_scale', String(v));
      } catch (_) { }
    })),

    /**
     * Sets the stroke width for edge connections. Persists to localStorage.
     * @param {number} value
     */
    setConnectionWidth: (value) => set(produce((draft) => {
      const v = Number(value);
      if (!Number.isFinite(v) || v < 0.25 || v > 4.0) {
        console.warn(`[setConnectionWidth] Invalid value: ${value}`);
        return;
      }
      draft.textSettings.connectionWidth = v;
      try {
        localStorage.setItem('redstring_connection_width', String(v));
      } catch (_) { }
    })),

    /**
     * Sets the scale multiplier for the plus-sign node creation affordance. Persists to localStorage.
     * @param {number} value
     */
    setPlusSignScale: (value) => set(produce((draft) => {
      const v = Number(value);
      if (!Number.isFinite(v) || v < 0.25 || v > 3.0) {
        console.warn(`[setPlusSignScale] Invalid value: ${value}`);
        return;
      }
      draft.textSettings.plusSignScale = v;
      try {
        localStorage.setItem('redstring_plus_sign_scale', String(v));
      } catch (_) { }
    })),

    /**
     * Sets the scale multiplier for the pie-menu radial overlay. Persists to localStorage.
     * @param {number} value
     */
    setPieMenuScale: (value) => set(produce((draft) => {
      const v = Number(value);
      if (!Number.isFinite(v) || v < 0.25 || v > 3.0) {
        console.warn(`[setPieMenuScale] Invalid value: ${value}`);
        return;
      }
      draft.textSettings.pieMenuScale = v;
      try {
        localStorage.setItem('redstring_pie_menu_scale', String(v));
      } catch (_) { }
    })),

    /**
     * Sets keyboard zoom sensitivity. Range [0, 1]. Persists to localStorage.
     * @param {number} value
     */
    setKeyboardZoomSensitivity: (value) => set(produce((draft) => {
      const v = Number(value);
      if (!Number.isFinite(v) || v < 0.0 || v > 1.0) {
        console.warn(`[setKeyboardZoomSensitivity] Invalid value: ${value}`);
        return;
      }
      if (!draft.keyboardSettings) draft.keyboardSettings = { zoomSensitivity: 0.5, panSensitivity: 0.5 };
      draft.keyboardSettings.zoomSensitivity = v;
      try {
        localStorage.setItem('redstring_keyboard_zoom_sensitivity', String(v));
      } catch (_) { }
    })),

    /**
     * Sets keyboard pan sensitivity. Range [0, 1]. Persists to localStorage.
     * @param {number} value
     */
    setKeyboardPanSensitivity: (value) => set(produce((draft) => {
      const v = Number(value);
      if (!Number.isFinite(v) || v < 0.0 || v > 1.0) {
        console.warn(`[setKeyboardPanSensitivity] Invalid value: ${value}`);
        return;
      }
      if (!draft.keyboardSettings) draft.keyboardSettings = { zoomSensitivity: 0.5, panSensitivity: 0.5 };
      draft.keyboardSettings.panSensitivity = v;
      try {
        localStorage.setItem('redstring_keyboard_pan_sensitivity', String(v));
      } catch (_) { }
    })),

    /** Toggles middle-mouse-button zoom. Persists to localStorage. */
    toggleMiddleMouseZoom: () => set(produce((draft) => {
      if (!draft.mouseSettings) draft.mouseSettings = { middleMouseZoomEnabled: false, nodeDragEdgePanEnabled: true, connectionDrawEdgePanEnabled: true };
      draft.mouseSettings.middleMouseZoomEnabled = !draft.mouseSettings.middleMouseZoomEnabled;
      try {
        localStorage.setItem('redstring_middle_mouse_zoom_enabled', String(draft.mouseSettings.middleMouseZoomEnabled));
      } catch (_) { }
    })),

    /** Toggles edge-pan-while-dragging-node. Persists to localStorage. */
    toggleNodeDragEdgePan: () => set(produce((draft) => {
      if (!draft.mouseSettings) draft.mouseSettings = { middleMouseZoomEnabled: false, nodeDragEdgePanEnabled: true, connectionDrawEdgePanEnabled: true };
      draft.mouseSettings.nodeDragEdgePanEnabled = !draft.mouseSettings.nodeDragEdgePanEnabled;
      try {
        localStorage.setItem('redstring_node_drag_edge_pan_enabled', String(draft.mouseSettings.nodeDragEdgePanEnabled));
      } catch (_) { }
    })),

    /** Toggles edge-pan-while-drawing-a-connection. Persists to localStorage. */
    toggleConnectionDrawEdgePan: () => set(produce((draft) => {
      if (!draft.mouseSettings) draft.mouseSettings = { middleMouseZoomEnabled: false, nodeDragEdgePanEnabled: true, connectionDrawEdgePanEnabled: true, glideEnabled: true };
      draft.mouseSettings.connectionDrawEdgePanEnabled = !draft.mouseSettings.connectionDrawEdgePanEnabled;
      try {
        localStorage.setItem('redstring_connection_draw_edge_pan_enabled', String(draft.mouseSettings.connectionDrawEdgePanEnabled));
      } catch (_) { }
    })),

    /** Toggles momentum/glide panning for mouse click-drag. Persists to localStorage. */
    toggleMouseGlide: () => set(produce((draft) => {
      if (!draft.mouseSettings) draft.mouseSettings = { middleMouseZoomEnabled: false, nodeDragEdgePanEnabled: true, connectionDrawEdgePanEnabled: true, glideEnabled: true, glideStrength: 0.1 };
      draft.mouseSettings.glideEnabled = draft.mouseSettings.glideEnabled === false;
      try {
        localStorage.setItem('redstring_mouse_glide_enabled', String(draft.mouseSettings.glideEnabled));
      } catch (_) { }
    })),

    /**
     * Sets how far mouse glide coasts after release. Range [0, 1]. Persists to localStorage.
     * @param {number} value
     */
    setMouseGlideStrength: (value) => set(produce((draft) => {
      const v = Number(value);
      if (!Number.isFinite(v) || v < 0.0 || v > 1.0) {
        console.warn(`[setMouseGlideStrength] Invalid value: ${value}`);
        return;
      }
      if (!draft.mouseSettings) draft.mouseSettings = { middleMouseZoomEnabled: false, nodeDragEdgePanEnabled: true, connectionDrawEdgePanEnabled: true, glideEnabled: true, glideStrength: 0.1 };
      draft.mouseSettings.glideStrength = v;
      try {
        localStorage.setItem('redstring_mouse_glide_strength', String(v));
      } catch (_) { }
    })),

    /**
     * Sets the hold duration (ms) before a node starts dragging. Clamped to [50, 1000]. Persists to localStorage.
     * @param {number} value
     */
    setNodeLiftDelay: (value) => set(produce((draft) => {
      const v = Math.round(Number(value));
      if (!Number.isFinite(v) || v < 50 || v > 1000) {
        console.warn(`[setNodeLiftDelay] Invalid value: ${value}`);
        return;
      }
      if (!draft.mouseSettings) draft.mouseSettings = { middleMouseZoomEnabled: false, nodeDragEdgePanEnabled: true, connectionDrawEdgePanEnabled: true, glideEnabled: true, glideStrength: 0.1, nodeLiftDelay: 250 };
      draft.mouseSettings.nodeLiftDelay = v;
      try {
        localStorage.setItem('redstring_node_lift_delay', String(v));
      } catch (_) { }
    })),

    /**
     * Sets touch pinch-zoom sensitivity. Range [0, 1]. Persists to localStorage.
     * @param {number} value
     */
    setTouchZoomSensitivity: (value) => set(produce((draft) => {
      const v = Number(value);
      if (!Number.isFinite(v) || v < 0.0 || v > 1.0) {
        console.warn(`[setTouchZoomSensitivity] Invalid value: ${value}`);
        return;
      }
      if (!draft.touchSettings) draft.touchSettings = { zoomSensitivity: 0.7, panSensitivity: 0.5 };
      draft.touchSettings.zoomSensitivity = v;
      try {
        localStorage.setItem('redstring_touch_zoom_sensitivity', String(v));
      } catch (_) { }
    })),

    /**
     * Sets touch single-finger pan sensitivity. Range [0, 1]. Persists to localStorage.
     * @param {number} value
     */
    setTouchPanSensitivity: (value) => set(produce((draft) => {
      const v = Number(value);
      if (!Number.isFinite(v) || v < 0.0 || v > 1.0) {
        console.warn(`[setTouchPanSensitivity] Invalid value: ${value}`);
        return;
      }
      if (!draft.touchSettings) draft.touchSettings = { zoomSensitivity: 0.7, panSensitivity: 0.5, glideEnabled: true };
      draft.touchSettings.panSensitivity = v;
      try {
        localStorage.setItem('redstring_touch_pan_sensitivity', String(v));
      } catch (_) { }
    })),

    /** Toggles momentum/glide panning for single-finger touch. Persists to localStorage. */
    toggleTouchGlide: () => set(produce((draft) => {
      if (!draft.touchSettings) draft.touchSettings = { zoomSensitivity: 0.7, panSensitivity: 0.5, glideEnabled: true, glideStrength: 0.5 };
      draft.touchSettings.glideEnabled = draft.touchSettings.glideEnabled === false;
      try {
        localStorage.setItem('redstring_touch_glide_enabled', String(draft.touchSettings.glideEnabled));
      } catch (_) { }
    })),

    /**
     * Sets how far touch glide coasts after release. Range [0, 1]. Persists to localStorage.
     * @param {number} value
     */
    setTouchGlideStrength: (value) => set(produce((draft) => {
      const v = Number(value);
      if (!Number.isFinite(v) || v < 0.0 || v > 1.0) {
        console.warn(`[setTouchGlideStrength] Invalid value: ${value}`);
        return;
      }
      if (!draft.touchSettings) draft.touchSettings = { zoomSensitivity: 0.7, panSensitivity: 0.5, glideEnabled: true, glideStrength: 0.5 };
      draft.touchSettings.glideStrength = v;
      try {
        localStorage.setItem('redstring_touch_glide_strength', String(v));
      } catch (_) { }
    })),

    /**
     * Sets trackpad pinch-zoom sensitivity. Range [0.1, 1]. Persists to localStorage.
     * @param {number} value
     */
    setTrackpadZoomSensitivity: (value) => set(produce((draft) => {
      const v = Number(value);
      if (!Number.isFinite(v) || v < 0.1 || v > 1.0) {
        console.warn(`[setTrackpadZoomSensitivity] Invalid value: ${value}`);
        return;
      }
      if (!draft.touchSettings) draft.touchSettings = { zoomSensitivity: 0.7, panSensitivity: 0.5, glideEnabled: true, glideStrength: 0.5, trackpadZoomSensitivity: 0.5, trackpadPanSensitivity: 0.5 };
      draft.touchSettings.trackpadZoomSensitivity = v;
      try {
        localStorage.setItem('redstring_trackpad_zoom_sensitivity', String(v));
      } catch (_) { }
    })),

    /**
     * Sets trackpad pan sensitivity. Range [0.1, 1]. Persists to localStorage.
     * @param {number} value
     */
    setTrackpadPanSensitivity: (value) => set(produce((draft) => {
      const v = Number(value);
      if (!Number.isFinite(v) || v < 0.1 || v > 1.0) {
        console.warn(`[setTrackpadPanSensitivity] Invalid value: ${value}`);
        return;
      }
      if (!draft.touchSettings) draft.touchSettings = { zoomSensitivity: 0.7, panSensitivity: 0.5, glideEnabled: true, glideStrength: 0.5, trackpadZoomSensitivity: 0.5, trackpadPanSensitivity: 0.5 };
      draft.touchSettings.trackpadPanSensitivity = v;
      try {
        localStorage.setItem('redstring_trackpad_pan_sensitivity', String(v));
      } catch (_) { }
    })),

    /**
     * Sets the auto-layout spacing preset.
     * @param {'compact'|'balanced'|'spacious'} preset
     */
    setLayoutScalePreset: (preset) => set(produce((draft) => {
      if (!draft.autoLayoutSettings) {
        draft.autoLayoutSettings = getDefaultAutoLayoutSettings();
      }
      if (!VALID_LAYOUT_SCALE_PRESETS.includes(preset)) {
        console.warn(`[setLayoutScalePreset] Invalid preset: ${preset}`);
        return;
      }
      draft.autoLayoutSettings.layoutScale = preset;
    })),

    /**
     * Sets the auto-layout scale multiplier. Clamped to [0.5, MAX_LAYOUT_SCALE_MULTIPLIER].
     * @param {number} value
     */
    setLayoutScaleMultiplier: (value) => set(produce((draft) => {
      if (!draft.autoLayoutSettings) {
        draft.autoLayoutSettings = getDefaultAutoLayoutSettings();
      }
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) {
        console.warn(`[setLayoutScaleMultiplier] Invalid multiplier: ${value}`);
        return;
      }
      const clamped = Math.max(0.5, Math.min(MAX_LAYOUT_SCALE_MULTIPLIER, Number(numeric.toFixed(2))));
      draft.autoLayoutSettings.layoutScaleMultiplier = clamped;
    })),

    /**
     * Sets the auto-layout iteration depth preset.
     * @param {'fast'|'balanced'|'deep'} preset
     */
    setLayoutIterationPreset: (preset) => set(produce((draft) => {
      if (!draft.autoLayoutSettings) {
        draft.autoLayoutSettings = getDefaultAutoLayoutSettings();
      }
      if (!VALID_LAYOUT_ITERATION_PRESETS.includes(preset)) {
        console.warn(`[setLayoutIterationPreset] Invalid preset: ${preset}`);
        return;
      }
      draft.autoLayoutSettings.layoutIterations = preset;
    })),

    /**
     * Sets the Force Tuner spacing preset.
     * @param {'compact'|'balanced'|'spacious'} preset
     */
    setForceTunerScalePreset: (preset) => set(produce((draft) => {
      if (!draft.forceTunerSettings) {
        draft.forceTunerSettings = getDefaultForceTunerSettings();
      }
      if (!VALID_LAYOUT_SCALE_PRESETS.includes(preset)) {
        console.warn(`[setForceTunerScalePreset] Invalid preset: ${preset}`);
        return;
      }
      draft.forceTunerSettings.layoutScale = preset;
    })),

    /**
     * Sets the Force Tuner scale multiplier. Clamped to [0.2, MAX_LAYOUT_SCALE_MULTIPLIER].
     * @param {number} value
     */
    setForceTunerScaleMultiplier: (value) => set(produce((draft) => {
      if (!draft.forceTunerSettings) {
        draft.forceTunerSettings = getDefaultForceTunerSettings();
      }
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) {
        console.warn(`[setForceTunerScaleMultiplier] Invalid multiplier: ${value}`);
        return;
      }
      const clamped = Math.max(0.2, Math.min(MAX_LAYOUT_SCALE_MULTIPLIER, Number(numeric.toFixed(2))));
      draft.forceTunerSettings.layoutScaleMultiplier = clamped;
    })),

    /**
     * Sets the Force Tuner iteration depth preset.
     * @param {'fast'|'balanced'|'deep'} preset
     */
    setForceTunerIterationPreset: (preset) => set(produce((draft) => {
      if (!draft.forceTunerSettings) {
        draft.forceTunerSettings = getDefaultForceTunerSettings();
      }
      if (!VALID_LAYOUT_ITERATION_PRESETS.includes(preset)) {
        console.warn(`[setForceTunerIterationPreset] Invalid preset: ${preset}`);
        return;
      }
      draft.forceTunerSettings.layoutIterations = preset;
    })),

    /**
     * Copies all current Force Tuner settings into the Auto Layout settings object.
     * Useful for promoting a tuned layout configuration to the default.
     */
    copyForceTunerSettingsToAutoLayout: () => set(produce((draft) => {
      if (!draft.forceTunerSettings) return;

      // Copy settings from tuner to auto-layout
      draft.autoLayoutSettings.layoutScale = draft.forceTunerSettings.layoutScale;
      draft.autoLayoutSettings.layoutScaleMultiplier = draft.forceTunerSettings.layoutScaleMultiplier;
      draft.autoLayoutSettings.layoutIterations = draft.forceTunerSettings.layoutIterations;

      console.log('[GraphStore] Copied force tuner settings to auto-layout:', {
        scale: draft.autoLayoutSettings.layoutScale,
        multiplier: draft.autoLayoutSettings.layoutScaleMultiplier,
        iterations: draft.autoLayoutSettings.layoutIterations
      });
    })),


    // ─── SELECTION & DEFINITION STATE ────────────────────────────────────────────

    /**
     * Explicitly sets the active definition node (prototype) context.
     * Used when switching graphs to keep the definition panel in sync.
     *
     * @param {string|null} nodeId - Prototype ID to set as the active definition context.
     */
    setActiveDefinitionNode: (nodeId) => {
      console.log(`[Store Action] Explicitly setting activeDefinitionNodeId to: ${nodeId}`);
      set({ activeDefinitionNodeId: nodeId });
    },

    /**
     * Sets the single selected edge for editing in the connection control panel.
     * @param {string|null} edgeId
     */
    setSelectedEdgeId: (edgeId) => {
      console.log(`[Store Action] Setting selectedEdgeId to: ${edgeId}`);
      set({ selectedEdgeId: edgeId });
    },

    /**
     * Replaces the entire multi-edge selection with the provided set.
     * @param {string[]|Iterable<string>} edgeIds
     */
    setSelectedEdgeIds: (edgeIds) => {
      console.log(`[Store Action] Setting selectedEdgeIds to:`, edgeIds);
      set({ selectedEdgeIds: new Set(edgeIds) });
    },

    /**
     * Adds an edge to the multi-edge selection.
     * @param {string} edgeId
     */
    addSelectedEdgeId: (edgeId) => set(produce((draft) => {
      draft.selectedEdgeIds.add(edgeId);
      console.log(`[Store Action] Added edge ${edgeId} to selection`);
    })),

    /**
     * Removes an edge from the multi-edge selection.
     * @param {string} edgeId
     */
    removeSelectedEdgeId: (edgeId) => set(produce((draft) => {
      draft.selectedEdgeIds.delete(edgeId);
      console.log(`[Store Action] Removed edge ${edgeId} from selection`);
    })),

    /** Clears all selected edges. */
    clearSelectedEdgeIds: () => set(produce((draft) => {
      draft.selectedEdgeIds.clear();
      console.log(`[Store Action] Cleared all selected edges`);
    })),

    /**
     * Sets the type list display mode in the left panel.
     * @param {'closed'|'node'|'connection'|'component'} mode
     */
    setTypeListMode: (mode) => {
      console.log(`[Store Action] Setting typeListMode to: ${mode}`);
      set({ typeListMode: mode });
    },

    // Set the type of a node prototype (duplicate removed; use earlier guarded version)

    /**
     * Removes a definition graph from a prototype's `definitionGraphIds` list.
     * If no other prototype references the graph, also deletes it and closes its tab.
     *
     * @param {string} nodeId - Prototype to remove the definition from.
     * @param {string} graphId - Definition graph to remove.
     */
    removeDefinitionFromNode: (nodeId, graphId) => set(produce((draft) => {
      const node = draft.nodePrototypes.get(nodeId);
      if (!node) {
        console.warn(`[Store removeDefinitionFromNode] Node prototype ${nodeId} not found.`);
        return;
      }

      // Remove the graph ID from the node's definition list
      if (Array.isArray(node.definitionGraphIds)) {
        const index = node.definitionGraphIds.indexOf(graphId);
        if (index > -1) {
          node.definitionGraphIds.splice(index, 1);
          console.log(`[Store removeDefinitionFromNode] Removed graph ${graphId} from node ${nodeId} definitions.`);
        } else {
          console.warn(`[Store removeDefinitionFromNode] Graph ${graphId} not found in node ${nodeId} definitions.`);
          return;
        }
      }

      // Check if any other nodes still reference this graph as a definition
      let isGraphStillReferenced = false;
      for (const otherNode of draft.nodePrototypes.values()) {
        if (otherNode.id !== nodeId && Array.isArray(otherNode.definitionGraphIds) && otherNode.definitionGraphIds.includes(graphId)) {
          isGraphStillReferenced = true;
          break;
        }
      }

      // If no other nodes reference this graph, delete it completely
      if (!isGraphStillReferenced) {
        console.log(`[Store removeDefinitionFromNode] Graph ${graphId} is no longer referenced, deleting it.`);

        // Remove from graphs map
        draft.graphs.delete(graphId);

        // Close the graph tab if it's open
        const openIndex = draft.openGraphIds.indexOf(graphId);
        if (openIndex > -1) {
          draft.openGraphIds.splice(openIndex, 1);

          // If this was the active graph, switch to another one
          if (draft.activeGraphId === graphId) {
            draft.activeGraphId = draft.openGraphIds.length > 0 ? draft.openGraphIds[0] : null;
            if (draft.activeGraphId === null) {
              draft.activeDefinitionNodeId = null;
            }
          }
        }

        // Remove from expanded set
        draft.expandedGraphIds.delete(graphId);

        // Delete all instances that belong to this graph is complex.
        // The graph is gone, so its instances are implicitly gone.
        // We might need a more robust cleanup later.

        console.log(`[Store removeDefinitionFromNode] Deleted graph ${graphId}.`);
      } else {
        console.log(`[Store removeDefinitionFromNode] Graph ${graphId} is still referenced by other nodes, keeping it.`);
      }
    })),

    /**
     * Opens or moves a graph tab to the front of the tab list and activates it.
     * Equivalent to the Panel.jsx double-click navigation behavior.
     *
     * @param {string} graphId - Graph to open/bring to front.
     * @param {string|null} [definitionNodeId=null] - Prototype to set as active definition context.
     */
    openGraphTabAndBringToTop: (graphId, definitionNodeId = null) => set(produce((draft) => {
      console.log(`[Store openGraphTabAndBringToTop] Called with graphId: ${graphId}, definitionNodeId: ${definitionNodeId}`);
      if (!draft.graphs.has(graphId)) {
        console.warn(`[Store openGraphTabAndBringToTop] Graph ${graphId} not found.`);
        return;
      }

      // Check if graph is already open
      const existingIndex = draft.openGraphIds.indexOf(graphId);

      if (existingIndex > -1) {
        // Graph is already open, move it to the front
        draft.openGraphIds.splice(existingIndex, 1); // Remove from current position
        draft.openGraphIds.unshift(graphId); // Add to front
        console.log(`[Store openGraphTabAndBringToTop] Moved existing graph ${graphId} to front.`);
      } else {
        // Graph is not open, add it to the front
        draft.openGraphIds.unshift(graphId);
        console.log(`[Store openGraphTabAndBringToTop] Added new graph ${graphId} to front.`);
      }

      // Set this graph as the active one
      draft.activeGraphId = graphId;
      console.log(`[Store openGraphTabAndBringToTop] Set activeGraphId to: ${graphId}`);

      // Set the definition node ID if provided
      if (definitionNodeId) {
        console.log(`[Store openGraphTabAndBringToTop] Setting activeDefinitionNodeId to: ${definitionNodeId}`);
        draft.activeDefinitionNodeId = definitionNodeId;
      } else {
        console.log(`[Store openGraphTabAndBringToTop] No definitionNodeId provided, clearing activeDefinitionNodeId.`);
        draft.activeDefinitionNodeId = null;
      }

      // Ensure the opened graph is expanded in the list
      draft.expandedGraphIds.add(graphId);
      console.log(`[Store openGraphTabAndBringToTop] Added ${graphId} to expanded set.`);
    })),

    // ─── CLEANUP & MAINTENANCE ───────────────────────────────────────────────────

    /**
     * Removes orphaned prototypes, graphs, and edges that are no longer reachable.
     *
     * A prototype is considered "reachable" if it is saved, has an open right-panel tab,
     * has a definition graph, is instantiated in a graph, or is protected.
     * Also prunes stale right-panel tabs, resets `activeDefinitionNodeId` if its
     * prototype was deleted, and removes edges referencing missing instances.
     * Called automatically 100ms after `toggleSavedNode` and `closeGraph`.
     */
    cleanupOrphanedData: () => set(produce((draft) => {
      console.log('[Store cleanupOrphanedData] Starting cleanup of orphaned data...');

      // UI reference hygiene before deeper cleanup
      // 1) Drop right panel node tabs that reference missing prototypes
      if (Array.isArray(draft.rightPanelTabs)) {
        const originalTabs = draft.rightPanelTabs.slice();
        draft.rightPanelTabs = draft.rightPanelTabs.filter(tab => {
          if (!tab || tab.type !== 'node') return true; // keep non-node tabs (e.g., home)
          return draft.nodePrototypes.has(tab.nodeId);
        });
        if (draft.rightPanelTabs.length !== originalTabs.length) {
          console.log('[Store cleanupOrphanedData] Pruned stale rightPanelTabs referencing deleted prototypes');
        }
        // Ensure there is at least a home tab and one active tab
        if (draft.rightPanelTabs.length === 0 || draft.rightPanelTabs[0]?.type !== 'home') {
          draft.rightPanelTabs.unshift({ type: 'home', isActive: true });
        }
        // Ensure one tab is active
        if (!draft.rightPanelTabs.some(t => t && t.isActive)) {
          draft.rightPanelTabs[0].isActive = true;
        }
      }

      // 2) Clear activeDefinitionNodeId if it references a missing prototype
      if (draft.activeDefinitionNodeId && !draft.nodePrototypes.has(draft.activeDefinitionNodeId)) {
        console.log(`[Store cleanupOrphanedData] Clearing stale activeDefinitionNodeId ${draft.activeDefinitionNodeId}`);
        draft.activeDefinitionNodeId = null;
      }

      // Step 1: Find all referenced prototypes and instances
      const referencedPrototypeIds = new Set();

      // Protect explicitly registered prototypes (e.g., Orbit catalog)
      if (draft.protectedPrototypeIds) {
        draft.protectedPrototypeIds.forEach((id) => referencedPrototypeIds.add(id));
      }

      // Add saved prototypes
      draft.savedNodeIds.forEach(prototypeId => referencedPrototypeIds.add(prototypeId));

      // Add prototypes that have open tabs (they're being viewed/edited)
      if (Array.isArray(draft.rightPanelTabs)) {
        draft.rightPanelTabs.forEach(tab => {
          if (tab && tab.type === 'node' && tab.nodeId) {
            referencedPrototypeIds.add(tab.nodeId);
          }
        });
      }

      // Add prototypes from all instances in open graphs
      draft.openGraphIds.forEach(graphId => {
        const graph = draft.graphs.get(graphId);
        if (!graph) {
          return;
        }

        if (graph.instances) {
          graph.instances.forEach(instance => referencedPrototypeIds.add(instance.prototypeId));
        }

        if (Array.isArray(graph.definingNodeIds)) {
          graph.definingNodeIds.forEach(nodeId => {
            if (draft.nodePrototypes.has(nodeId)) {
              referencedPrototypeIds.add(nodeId);
            }
          });
        }
      });

      // Add prototypes that are being used as types by other prototypes
      for (const prototype of draft.nodePrototypes.values()) {
        if (prototype.typeNodeId) {
          referencedPrototypeIds.add(prototype.typeNodeId);
        }
      }

      // Add prototypes that back node-groups (groups with linkedNodePrototypeId)
      draft.graphs.forEach(graph => {
        if (graph.groups) {
          graph.groups.forEach(group => {
            if (group.linkedNodePrototypeId) {
              referencedPrototypeIds.add(group.linkedNodePrototypeId);
            }
          });
        }
      });

      // Add prototypes that are referenced by edges (connection types)
      for (const [edgeId, edge] of draft.edges.entries()) {
        // Check definitionNodeIds (new approach)
        if (edge.definitionNodeIds && Array.isArray(edge.definitionNodeIds)) {
          edge.definitionNodeIds.forEach(nodeId => referencedPrototypeIds.add(nodeId));
        }
        // Check typeNodeId (legacy approach)
        if (edge.typeNodeId) {
          referencedPrototypeIds.add(edge.typeNodeId);
        }
      }

      // Add prototypes that are members of any abstraction chain. Chains can
      // reference prototypes that exist only in the universe (no instance in any
      // open graph) — e.g. a more-general/more-specific layer added via the
      // carousel. Without this, those layers are swept as orphans the moment they
      // are added, so "Add Above/Below" appears to do nothing.
      for (const prototype of draft.nodePrototypes.values()) {
        if (prototype.abstractionChains) {
          for (const chain of Object.values(prototype.abstractionChains)) {
            if (Array.isArray(chain)) {
              chain.forEach(memberId => referencedPrototypeIds.add(memberId));
            }
          }
        }
      }

      // Recursively add prototypes from definition graphs
      const addDefinitionPrototypes = (prototypeId) => {
        const prototype = draft.nodePrototypes.get(prototypeId);
        if (prototype && Array.isArray(prototype.definitionGraphIds)) {
          prototype.definitionGraphIds.forEach(graphId => {
            const defGraph = draft.graphs.get(graphId);
            if (defGraph && defGraph.instances) {
              defGraph.instances.forEach(instance => {
                if (!referencedPrototypeIds.has(instance.prototypeId)) {
                  referencedPrototypeIds.add(instance.prototypeId);
                  addDefinitionPrototypes(instance.prototypeId); // Recurse
                }
              });
            }
          });
        }
      };

      Array.from(referencedPrototypeIds).forEach(prototypeId => addDefinitionPrototypes(prototypeId));

      // Step 2: Find all referenced graphs
      const referencedGraphIds = new Set();

      // Add open graphs
      draft.openGraphIds.forEach(graphId => referencedGraphIds.add(graphId));

      // Add definition graphs from referenced prototypes
      referencedPrototypeIds.forEach(prototypeId => {
        const prototype = draft.nodePrototypes.get(prototypeId);
        if (prototype && Array.isArray(prototype.definitionGraphIds)) {
          prototype.definitionGraphIds.forEach(graphId => referencedGraphIds.add(graphId));
        }
      });

      // Ensure defining prototypes for referenced graphs are also retained.
      const collectDefiningPrototypes = () => {
        const discovered = [];
        referencedGraphIds.forEach(graphId => {
          const graph = draft.graphs.get(graphId);
          if (graph && Array.isArray(graph.definingNodeIds)) {
            graph.definingNodeIds.forEach(nodeId => {
              if (draft.nodePrototypes.has(nodeId) && !referencedPrototypeIds.has(nodeId)) {
                referencedPrototypeIds.add(nodeId);
                discovered.push(nodeId);
              }
            });
          }
        });
        return discovered;
      };

      let newlyDiscovered = collectDefiningPrototypes();
      while (newlyDiscovered.length > 0) {
        newlyDiscovered.forEach(prototypeId => {
          addDefinitionPrototypes(prototypeId);
          const prototype = draft.nodePrototypes.get(prototypeId);
          if (prototype && Array.isArray(prototype.definitionGraphIds)) {
            prototype.definitionGraphIds.forEach(graphId => {
              if (draft.graphs.has(graphId)) {
                referencedGraphIds.add(graphId);
              }
            });
          }
        });
        newlyDiscovered = collectDefiningPrototypes();
      }

      // Step 3: Remove orphaned prototypes
      const orphanedPrototypes = [];
      for (const prototypeId of draft.nodePrototypes.keys()) {
        if (!referencedPrototypeIds.has(prototypeId)) {
          orphanedPrototypes.push(prototypeId);
        }
      }

      orphanedPrototypes.forEach(prototypeId => {
        console.log(`[Store cleanupOrphanedData] Removing orphaned prototype: ${prototypeId}`);
        draft.nodePrototypes.delete(prototypeId);
      });

      // Step 4: Remove orphaned graphs (and their instances/edges)
      const orphanedGraphs = [];
      for (const graphId of draft.graphs.keys()) {
        if (!referencedGraphIds.has(graphId)) {
          orphanedGraphs.push(graphId);
        }
      }

      orphanedGraphs.forEach(graphId => {
        console.log(`[Store cleanupOrphanedData] Removing orphaned graph: ${graphId}`);
        draft.graphs.delete(graphId);

        // Also clean up related state
        draft.expandedGraphIds.delete(graphId);

        // Remove from right panel tabs if open
        draft.rightPanelTabs = draft.rightPanelTabs.filter(tab =>
          tab.type !== 'graph' || tab.graphId !== graphId
        );
      });

      // Step 5: Remove orphaned edges
      const orphanedEdges = [];
      const allInstanceIds = new Set();
      draft.graphs.forEach(g => {
        if (g.instances) {
          g.instances.forEach(inst => allInstanceIds.add(inst.id));
        }
      });

      for (const [edgeId, edge] of draft.edges.entries()) {
        const sourceExists = allInstanceIds.has(edge.sourceId);
        const destExists = allInstanceIds.has(edge.destinationId);
        if (!sourceExists || !destExists) {
          orphanedEdges.push(edgeId);
        }
      }

      orphanedEdges.forEach(edgeId => {
        console.log(`[Store cleanupOrphanedData] Removing orphaned edge: ${edgeId}`);
        draft.edges.delete(edgeId);
      });

      // Step 6: Clean up edge references in remaining graphs
      referencedGraphIds.forEach(graphId => {
        const graph = draft.graphs.get(graphId);
        if (graph && Array.isArray(graph.edgeIds)) {
          const originalLength = graph.edgeIds.length;
          graph.edgeIds = graph.edgeIds.filter(edgeId => draft.edges.has(edgeId));
          if (graph.edgeIds.length !== originalLength) {
            console.log(`[Store cleanupOrphanedData] Cleaned edge references in graph ${graphId}`);
          }
        }
      });

      // Clean up orphaned anchor instances whose group no longer exists
      for (const [graphId, graph] of draft.graphs.entries()) {
        if (!graph.instances) continue;
        const orphanedAnchors = [];
        for (const [instId, inst] of graph.instances.entries()) {
          if (inst.isGroupAnchor && inst.anchorForGroupId) {
            if (!graph.groups?.has(inst.anchorForGroupId)) {
              orphanedAnchors.push(instId);
            }
          }
        }
        orphanedAnchors.forEach(instId => {
          // Remove edges connected to orphaned anchor
          const edgesToRemove = [];
          draft.edges.forEach((edge, edgeId) => {
            if (edge.sourceId === instId || edge.destinationId === instId) {
              edgesToRemove.push(edgeId);
            }
          });
          edgesToRemove.forEach(edgeId => {
            draft.edges.delete(edgeId);
            if (graph.edgeIds) {
              const idx = graph.edgeIds.indexOf(edgeId);
              if (idx > -1) graph.edgeIds.splice(idx, 1);
            }
          });
          const anchorGroupId = graph.instances.get(instId)?.anchorForGroupId;
          graph.instances.delete(instId);
          console.log(`[Store cleanupOrphanedData] Removed orphaned anchor instance ${instId} (group ${anchorGroupId} no longer exists)`);
        });
      }

      // Step 7: Sweep orphan member IDs from group memberInstanceIds.
      // The canonical delete paths (removeNodeInstance, removeMultipleNodeInstances)
      // already prune memberInstanceIds, but older .redstring saves and any
      // non-canonical mutation paths (e.g. wizard/MCP tools) can leave stale IDs.
      // Without this sweep, drag-time bounds explode toward (0,0) when an orphan
      // ID is read.
      let totalOrphanMembers = 0;
      for (const [, graph] of draft.graphs.entries()) {
        if (!graph.groups || !graph.instances) continue;
        const liveInstanceIds = graph.instances;
        for (const [groupId, group] of graph.groups.entries()) {
          if (!Array.isArray(group.memberInstanceIds) || group.memberInstanceIds.length === 0) continue;
          const before = group.memberInstanceIds.length;
          group.memberInstanceIds = group.memberInstanceIds.filter(id => liveInstanceIds.has(id));
          const removed = before - group.memberInstanceIds.length;
          if (removed > 0) {
            totalOrphanMembers += removed;
            console.log(`[Store cleanupOrphanedData] Removed ${removed} orphan member IDs from group ${groupId}`);
          }
        }
      }

      console.log(`[Store cleanupOrphanedData] Cleanup complete. Removed ${orphanedPrototypes.length} prototypes, ${orphanedGraphs.length} graphs, ${orphanedEdges.length} edges, ${totalOrphanMembers} orphan group members.`);
    })),

    // ─── UNIVERSE & FILE MANAGEMENT ──────────────────────────────────────────────

    /**
     * Restores the last saved session from local storage.
     * @async
     */
    restoreFromSession: async () => {
      try {
        const result = await restoreLastSession();
        return result; // Return the result object for the component to handle
      } catch (error) {
        console.error('[Store] Error restoring from session:', error);
        return { success: false, error: error.message };
      }
    },

    /**
     * Returns the current file status object from the file storage layer.
     * @returns {Object} File status including `hasFile`, `fileName`, etc.
     */
    getFileStatus: () => getFileStatus(),

    /**
     * Replaces all store state with the provided universe data object.
     *
     * Deserializes Maps and Sets from the plain-object format used in `.redstring` files.
     * Sets `isUniverseLoaded: true` and `isUniverseLoading: false` on success.
     * Does NOT save or touch the file handle — call SaveCoordinator separately if needed.
     *
     * @param {Object} dataToLoad - Deserialized universe state (from `importFromRedstring`).
     */
    loadUniverseFromFile: (dataToLoad) => {
      try {
        // CRITICAL: Prevent concurrent loads - check if a load is already in progress
        const currentState = api.getState();
        if (currentState._isLoadingUniverse) {
          console.warn("[graphStore] Load already in progress, ignoring concurrent load attempt");
          return false;
        }

        // Set loading lock
        set({ _isLoadingUniverse: true });

        // If dataToLoad already contains Maps (i.e., was returned by importFromRedstring earlier) we can use it directly.
        const isAlreadyDeserialized = dataToLoad && dataToLoad.graphs instanceof Map;

        let storeState;
        if (isAlreadyDeserialized) {
          storeState = dataToLoad;
        } else {
          // Use the centralized import function to correctly deserialize the
          // data. A critical import failure THROWS (caught below → the store
          // enters the universeLoadingError state, which blocks all saves) —
          // it must never be loaded as an empty universe, because that empty
          // state would become the save baseline and overwrite the real file.
          const { storeState: importedState, errors } = importFromRedstring(dataToLoad);
          if (errors && errors.length > 0) {
            // Partial import: entities failed but the file was structurally
            // valid. If nothing usable survived, treat it as a failed load
            // rather than adopting an empty state.
            console.error("[graphStore] Errors importing from Redstring:", errors);
            const nodeCount = importedState?.nodePrototypes?.size || 0;
            const graphCount = importedState?.graphs?.size || 0;
            if (nodeCount === 0 && graphCount === 0) {
              throw new Error(`Import produced no usable data (${errors.length} error(s): ${errors[0]})`);
            }
          }
          storeState = importedState;
        }

        // Validate that we have a valid storeState
        if (!storeState || typeof storeState !== 'object') {
          console.error("[graphStore] Invalid storeState after import:", storeState);
          set({
            isUniverseLoaded: true,
            isUniverseLoading: false,
            universeLoadingError: "Failed to load universe: Invalid data format",
            hasUniverseFile: false,
            _isLoadingUniverse: false,
          });
          return false;
        }

        // Merge edge prototypes with the store's base/agent defaults. An old
        // file (or one saved before edgePrototypes round-tripped) carries an
        // empty Map — spreading that would wipe the base "Connection" type and
        // agent edge types the store seeds at init, dangling every edge's
        // typeNodeId. Keep existing entries and layer the file's on top.
        try {
          const incomingEdgeProtos = storeState.edgePrototypes;
          const existingEdgeProtos = currentState.edgePrototypes;
          if (existingEdgeProtos instanceof Map) {
            const merged = new Map(existingEdgeProtos);
            if (incomingEdgeProtos instanceof Map) {
              for (const [id, proto] of incomingEdgeProtos) merged.set(id, proto);
            }
            storeState.edgePrototypes = merged;
          }
        } catch (e) {
          console.warn('[graphStore] Failed to merge edgePrototypes during load:', e);
          delete storeState.edgePrototypes; // fall back to keeping current
        }

        // Normalize all edge directionality to ensure arrowsToward is always a Set
        if (storeState.edges) {
          for (const [edgeId, edgeData] of storeState.edges.entries()) {
            try {
              edgeData.directionality = normalizeEdgeDirectionality(edgeData.directionality);
            } catch (error) {
              console.warn(`[graphStore] Error normalizing edge ${edgeId} directionality:`, error);
              // Set a safe default
              edgeData.directionality = { arrowsToward: new Set() };
            }
          }
        }

        // Sanitize UI references: drop node tabs pointing to non-existent prototypes
        if (Array.isArray(storeState.rightPanelTabs)) {
          try {
            const tabs = storeState.rightPanelTabs.filter(tab => {
              if (!tab || tab.type !== 'node') return true; // keep non-node tabs (e.g., home)
              return storeState.nodePrototypes?.has?.(tab.nodeId);
            });
            // Ensure a home tab exists and is active if none active
            if (tabs.length === 0 || tabs[0]?.type !== 'home') {
              tabs.unshift({ type: 'home', isActive: true });
            }
            if (!tabs.some(t => t && t.isActive)) {
              tabs[0].isActive = true;
            }
            storeState.rightPanelTabs = tabs;
          } catch (e) {
            console.warn('[graphStore] Failed to sanitize rightPanelTabs during load:', e);
            storeState.rightPanelTabs = [{ type: 'home', isActive: true }];
          }
        }

        // Sanitize saved sets to remove references to missing prototypes
        try {
          if (storeState.savedNodeIds instanceof Set) {
            storeState.savedNodeIds = new Set(Array.from(storeState.savedNodeIds).filter(id => storeState.nodePrototypes?.has?.(id)));
          }
          if (storeState.savedGraphIds instanceof Set) {
            storeState.savedGraphIds = new Set(Array.from(storeState.savedGraphIds).filter(id => storeState.nodePrototypes?.has?.(id)));
          }
        } catch (e) {
          console.warn('[graphStore] Failed to sanitize saved sets during load:', e);
        }

        console.log("[graphStore] Loading universe with", {
          nodes: storeState.nodePrototypes?.size || 0,
          graphs: storeState.graphs?.size || 0,
          edges: storeState.edges?.size || 0
        });

        // Sanitize and recover activeGraphId / openGraphIds:
        //   - drop dangling references to graphs that don't exist
        //   - if activeGraphId is missing/dangling but valid open or saved graphs
        //     remain, pick one so the canvas doesn't render the empty state
        //     (the "loaded but unlinked" pattern)
        try {
          const graphsMap = storeState.graphs;
          const graphExists = (id) => !!(id && graphsMap && (graphsMap instanceof Map ? graphsMap.has(id) : graphsMap[id]));

          if (Array.isArray(storeState.openGraphIds)) {
            storeState.openGraphIds = storeState.openGraphIds.filter(graphExists);
          } else {
            storeState.openGraphIds = [];
          }

          if (!graphExists(storeState.activeGraphId)) {
            const firstOpen = storeState.openGraphIds[0];
            if (firstOpen) {
              storeState.activeGraphId = firstOpen;
            } else if (graphsMap) {
              const firstGraphId = graphsMap instanceof Map
                ? graphsMap.keys().next().value
                : Object.keys(graphsMap)[0];
              if (firstGraphId) {
                storeState.activeGraphId = firstGraphId;
                if (!storeState.openGraphIds.includes(firstGraphId)) {
                  storeState.openGraphIds = [firstGraphId, ...storeState.openGraphIds];
                }
                console.log(`[graphStore] activeGraphId was null/dangling — recovered to ${firstGraphId}`);
              } else {
                storeState.activeGraphId = null;
              }
            } else {
              storeState.activeGraphId = null;
            }
          }
        } catch (e) {
          console.warn('[graphStore] Failed to recover activeGraphId during load:', e);
        }

        // Mark this as a load operation so SaveCoordinator doesn't treat it as a new edit
        api.setChangeContext({ type: 'load' });

        set({
          ...storeState,
          showConnectionNames: currentState.showConnectionNames, // Preserve local view preference
          isUniverseLoaded: true,
          isUniverseLoading: false,
          universeLoadingError: null,
          hasUniverseFile: true,
          _isLoadingUniverse: false,
        });

        return true;
      } catch (error) {
        console.error("[graphStore] Critical error in loadUniverseFromFile:", error);
        set({
          isUniverseLoaded: true,
          isUniverseLoading: false,
          universeLoadingError: `Failed to load universe: ${error.message}`,
          hasUniverseFile: false,
          _isLoadingUniverse: false,
        });
        return false;
      }
    },

    /**
     * Sets the universe loading error message (shown in the loading UI).
     * Pass `null` to clear the error.
     * @param {string|null} error
     */
    setUniverseError: (error) => set({
      isUniverseLoaded: true, // Loading is complete, but with an error
      isUniverseLoading: false,
      universeLoadingError: error,
      hasUniverseFile: false
    }),

    // ─── ABSTRACTION CHAIN ────────────────────────────────────────────────────────

    /**
     * Inserts a node into an abstraction chain for a given dimension and direction.
     *
     * Abstraction chains represent the Is-a hierarchy (Tree of Porphyry). Each node
     * can have a chain in the specificity dimension. The new node is inserted relative
     * to `insertRelativeToNodeId` in the specified direction.
     *
     * @param {string} nodeId - Prototype ID that owns the chain.
     * @param {string} dimension - The abstraction dimension (e.g., 'specificity').
     * @param {'above'|'below'} direction - Insert above (more general) or below (more specific).
     * @param {string} newNodeId - Prototype ID of the node to insert into the chain.
     * @param {string|null} insertRelativeToNodeId - Existing chain member to insert relative to.
     */
    addToAbstractionChain: (nodeId, dimension, direction, newNodeId, insertRelativeToNodeId) => set(produce((draft) => {
      console.log(`[Store] addToAbstractionChain called with:`, {
        nodeId,
        dimension,
        direction,
        newNodeId,
        insertRelativeToNodeId
      });

      const node = draft.nodePrototypes.get(nodeId);
      if (!node) {
        console.error(`Node ${nodeId} not found`);
        return;
      }

      console.log(`[Store] Found chain owner node:`, {
        id: node.id,
        name: node.name,
        hasAbstractionChains: !!node.abstractionChains,
        existingChain: node.abstractionChains?.[dimension]
      });

      // Initialize abstraction chains if they don't exist
      if (!node.abstractionChains) {
        node.abstractionChains = {};
      }

      // Initialize this dimension if it doesn't exist
      if (!node.abstractionChains[dimension]) {
        node.abstractionChains[dimension] = [nodeId]; // Start with just this node
      }

      const chain = node.abstractionChains[dimension];

      // Prevent duplicate entries of the node being added
      if (chain.includes(newNodeId)) {
        console.log(`[Store] Skipping addToAbstractionChain: ${newNodeId} already in ${dimension} chain for ${nodeId}`);
      } else {

        // If insertRelativeToNodeId is provided, insert relative to that node
        if (insertRelativeToNodeId && insertRelativeToNodeId !== nodeId) {
          const relativeIndex = chain.indexOf(insertRelativeToNodeId);
          if (relativeIndex !== -1) {
            if (direction === 'above') {
              // More specific - insert before the relative node
              chain.splice(relativeIndex, 0, newNodeId);
            } else {
              // More general - insert after the relative node
              chain.splice(relativeIndex + 1, 0, newNodeId);
            }
            console.log(`Added ${newNodeId} ${direction} ${insertRelativeToNodeId} in ${dimension} dimension. Chain:`, chain);
            return;
          } else {
            console.warn(`Relative node ${insertRelativeToNodeId} not found in chain, inserting both nodes`);
            // If the relative node isn't in the chain yet, we need to handle this case
            // Insert both the relative node and the new node in the correct order
            const chainOwnerIndex = chain.indexOf(nodeId);
            if (chainOwnerIndex !== -1) {
              if (direction === 'above') {
                // Insert relative node at chain owner position, then new node above it
                chain.splice(chainOwnerIndex, 0, newNodeId, insertRelativeToNodeId);
              } else {
                // Insert relative node at chain owner position, then new node below it  
                chain.splice(chainOwnerIndex, 0, insertRelativeToNodeId, newNodeId);
              }
              console.log(`Added relative node ${insertRelativeToNodeId} and new node ${newNodeId} ${direction} it. Chain:`, chain);
              return;
            }
          }
        }

        // Fallback: insert relative to the chain owner (original behavior)
        const currentIndex = chain.indexOf(nodeId);

        if (currentIndex === -1) {
          // Node not in chain, add it first
          chain.push(nodeId);
        }

        // Add new node in the right position relative to chain owner
        const updatedCurrentIndex = chain.indexOf(nodeId);
        if (direction === 'above') {
          // More specific - insert before the chain owner
          chain.splice(updatedCurrentIndex, 0, newNodeId);
        } else {
          // More general - insert after the chain owner
          chain.splice(updatedCurrentIndex + 1, 0, newNodeId);
        }

        console.log(`Added ${newNodeId} ${direction} ${nodeId} in ${dimension} dimension. Chain:`, chain);
      }
    })),

    /**
     * Removes a node from an abstraction chain.
     * @param {string} nodeId - Prototype ID that owns the chain.
     * @param {string} dimension - The abstraction dimension.
     * @param {string} nodeToRemove - Prototype ID of the node to remove from the chain.
     */
    removeFromAbstractionChain: (nodeId, dimension, nodeToRemove) => set(produce((draft) => {
      const node = draft.nodePrototypes.get(nodeId);
      if (!node?.abstractionChains?.[dimension]) return;

      const chain = node.abstractionChains[dimension];
      const index = chain.indexOf(nodeToRemove);
      if (index > -1) {
        chain.splice(index, 1);
        console.log(`Removed ${nodeToRemove} from ${nodeId}'s ${dimension} chain`);
      }
    })),

    /**
     * Replaces one node with another in all abstraction chains.
     * Used when renaming/retyping a node that participates in chains.
     *
     * @param {string} currentNodeId - Prototype ID to replace.
     * @param {string} newNodeId - Prototype ID to substitute in.
     */
    swapNodeInChain: (currentNodeId, newNodeId) => set(produce((draft) => {
      // This will be used by the swap button in the carousel
      // For now, just log the action - the actual swap will happen in the UI layer
      console.log(`Swapping ${currentNodeId} with ${newNodeId}`);
    })),

    /** Resets all store state to the empty default. Used to start a new universe. */
    clearUniverse: () => set(() => ({
      graphs: new Map(),
      nodePrototypes: new Map(),
      edges: new Map(),
      pendingDeletions: new Map(),
      gracePeriodMs: 5 * 60 * 1000, // Reset to default
      openGraphIds: [],
      activeGraphId: null,
      activeDefinitionNodeId: null,
      rightPanelTabs: [{ type: 'home', isActive: true }],
      expandedGraphIds: new Set(),
      savedNodeIds: new Set(),
      savedGraphIds: new Set(),
      isUniverseLoaded: false,
      isUniverseLoading: false,
      universeLoadingError: null,
      hasUniverseFile: false,
    })),

    /** Marks the universe as connected to a file (hasUniverseFile). @param {boolean} [hasFile=true] */
    setUniverseConnected: (hasFile = true) => set(state => ({
      ...state,
      hasUniverseFile: hasFile
    })),

    /** Marks the universe load as complete. @param {boolean} [loaded=true] @param {boolean} [hasFile=true] */
    setUniverseLoaded: (loaded = true, hasFile = true) => set(state => ({
      ...state,
      isUniverseLoaded: loaded,
      isUniverseLoading: false,
      hasUniverseFile: hasFile,
      universeLoadingError: null
    })),

    /** Sets the storage mode. @param {'local'|'git'|'hybrid'} mode */
    setStorageMode: (mode) => set(state => ({
      ...state,
      storageMode: mode
    })),
    /** Merges partial Git settings into the gitSettings object. @param {Object} settings */
    updateGitSettings: (settings) => set(state => ({
      ...state,
      gitSettings: { ...state.gitSettings, ...settings }
    })),

    /** Persists pan/zoom viewport state for a graph. @param {string} graphId @param {{x: number, y: number}} panOffset @param {number} zoomLevel */
    updateGraphView: (graphId, panOffset, zoomLevel) => {
      // #region agent log
      debugLogSync('graphStore.js:updateGraphView', 'updateGraphView called', { graphId, zoomLevel: zoomLevel?.toFixed?.(3) }, 'debug-session', 'C');
      // #endregion
      api.setChangeContext({ type: 'viewport', target: 'graph' });
      set(produce((draft) => {
        const graph = draft.graphs.get(graphId);
        if (graph) {
          graph.panOffset = panOffset;
          graph.zoomLevel = zoomLevel;
        }
      }));
    },

    /** Sets the active Git remote connection configuration. @param {Object} connectionConfig */
    setGitConnection: (connectionConfig) => {
      set(produce((draft) => {
        draft.gitConnection = connectionConfig;
        // Persist to localStorage
        localStorage.setItem('redstring_git_connection', JSON.stringify(connectionConfig));
      }));
    },

    /** Clears the Git remote connection and removes it from localStorage. */
    clearGitConnection: () => {
      set(produce((draft) => {
        draft.gitConnection = null;
        draft.gitSyncEngine = null;
        // Clear from localStorage
        localStorage.removeItem('redstring_git_connection');
      }));
    },

    /** Sets the live GitSyncEngine instance (called by UniverseManager). @param {Object} syncEngine */
    setGitSyncEngine: (syncEngine) => {
      set(produce((draft) => {
        draft.gitSyncEngine = syncEngine;
      }));
    },

    /** Sets whether 'local' or 'git' is the authoritative data source. @param {'local'|'git'} sourceOfTruth */
    setGitSourceOfTruth: (sourceOfTruth) => {
      set(produce((draft) => {
        draft.gitSourceOfTruth = sourceOfTruth;
        // Persist to localStorage
        localStorage.setItem('redstring_git_source_of_truth', sourceOfTruth);
      }));
    },

    // ─── DELETION ─────────────────────────────────────────────────────────────────

    /**
     * Permanently deletes a node prototype and all of its associated data.
     *
     * Also deletes any graphs that list this prototype as their sole defining node,
     * removes all instances of this prototype from all graphs, removes connected edges,
     * removes the prototype from saved/panel state, and closes any open tabs.
     * Cannot delete the base `base-thing-prototype` or `base-connection-prototype`.
     *
     * @param {string} prototypeId - ID of the prototype to delete.
     */
    deleteNodePrototype: (prototypeId) => set(produce((draft) => {
      console.log(`[Store deleteNodePrototype] Deleting prototype: ${prototypeId}`);

      // Check if this is the base "Thing" or "Connection" type - prevent deletion
      if (prototypeId === 'base-thing-prototype') {
        console.warn(`[Store deleteNodePrototype] Cannot delete base "Thing" type.`);
        return;
      }
      if (prototypeId === 'base-connection-prototype') {
        console.warn(`[Store deleteNodePrototype] Cannot delete base "Connection" type.`);
        return;
      }

      const prototype = draft.nodePrototypes.get(prototypeId);
      if (!prototype) {
        console.warn(`[Store deleteNodePrototype] Prototype ${prototypeId} not found.`);
        return;
      }

      // Find and clean up graphs that reference this prototype as their defining node
      const graphsToDelete = [];
      draft.graphs.forEach((graph, graphId) => {
        if (graph.definingNodeIds?.includes(prototypeId)) {
          graphsToDelete.push(graphId);
          console.log(`[Store deleteNodePrototype] Marking orphaned graph for deletion: ${graphId}`);
        }
      });

      // Delete orphaned graphs (this will also clean up their instances and edges)
      graphsToDelete.forEach(graphId => {
        const graph = draft.graphs.get(graphId);
        if (graph) {
          // Remove from open graphs
          draft.openGraphIds = draft.openGraphIds.filter(id => id !== graphId);

          // Remove from expanded graphs
          draft.expandedGraphIds.delete(graphId);

          // Clear active graph if it was this one
          if (draft.activeGraphId === graphId) {
            draft.activeGraphId = draft.openGraphIds.length > 0 ? draft.openGraphIds[0] : null;
          }

          // Remove from right panel tabs if open
          draft.rightPanelTabs = draft.rightPanelTabs.filter(tab =>
            tab.type !== 'graph' || tab.graphId !== graphId
          );

          // Delete all edges in this graph
          if (graph.edgeIds) {
            graph.edgeIds.forEach(edgeId => {
              draft.edges.delete(edgeId);
            });
          }

          // Delete the graph
          draft.graphs.delete(graphId);
          console.log(`[Store deleteNodePrototype] Deleted orphaned graph: ${graphId}`);
        }
      });

      // Remove from saved nodes if it's saved
      draft.savedNodeIds.delete(prototypeId);

      // Remove from right panel tabs if open
      draft.rightPanelTabs = draft.rightPanelTabs.filter(tab => tab.nodeId !== prototypeId);

      // Clear active definition node if it was this one
      if (draft.activeDefinitionNodeId === prototypeId) {
        draft.activeDefinitionNodeId = null;
      }

      // Delete the prototype
      draft.nodePrototypes.delete(prototypeId);

      console.log(`[Store deleteNodePrototype] Successfully deleted prototype: ${prototypeId} and ${graphsToDelete.length} orphaned graphs`);
    })),

    /**
     * Permanently deletes a graph and all of its associated data.
     *
     * Removes all instances in the graph, all edges, closes the tab, and clears
     * any active-graph references. Also removes the graph ID from its defining
     * prototypes' `definitionGraphIds` lists.
     *
     * @param {string} graphId - ID of the graph to delete.
     */
    deleteGraph: (graphId) => set(produce((draft) => {
      console.log(`[Store deleteGraph] Deleting graph: ${graphId}`);

      const graph = draft.graphs.get(graphId);
      if (!graph) {
        console.warn(`[Store deleteGraph] Graph ${graphId} not found.`);
        return;
      }

      // Remove from open graphs
      draft.openGraphIds = draft.openGraphIds.filter(id => id !== graphId);

      // Remove from expanded graphs
      draft.expandedGraphIds.delete(graphId);

      // Clear active graph if it was this one
      if (draft.activeGraphId === graphId) {
        draft.activeGraphId = draft.openGraphIds.length > 0 ? draft.openGraphIds[0] : null;
      }

      // Clear active definition node if it was defined by this graph
      if (draft.activeDefinitionNodeId && graph.definingNodeIds?.includes(draft.activeDefinitionNodeId)) {
        draft.activeDefinitionNodeId = null;
      }

      // Remove from right panel tabs if open
      draft.rightPanelTabs = draft.rightPanelTabs.filter(tab =>
        tab.type !== 'graph' || tab.graphId !== graphId
      );

      // Delete all edges in this graph
      if (graph.edgeIds) {
        graph.edgeIds.forEach(edgeId => {
          draft.edges.delete(edgeId);
        });
      }

      // Delete the graph (this will also delete all instances)
      draft.graphs.delete(graphId);

      console.log(`[Store deleteGraph] Successfully deleted graph: ${graphId}`);
    })),

    /**
     * Removes graphs that are no longer referenced by any prototype's `definitionGraphIds`.
     * Also deletes all edges belonging to each orphaned graph.
     */
    cleanupOrphanedGraphs: () => set(produce((draft) => {
      console.log('[Store cleanupOrphanedGraphs] Starting cleanup...');

      const orphanedGraphs = [];
      draft.graphs.forEach((graph, graphId) => {
        if (graph.definingNodeIds) {
          const hasOrphanedReferences = graph.definingNodeIds.some(nodeId =>
            !draft.nodePrototypes.has(nodeId)
          );

          if (hasOrphanedReferences) {
            orphanedGraphs.push(graphId);
            console.log(`[Store cleanupOrphanedGraphs] Found orphaned graph: ${graphId}`);
          }
        }
      });

      // Delete orphaned graphs
      orphanedGraphs.forEach(graphId => {
        const graph = draft.graphs.get(graphId);
        if (graph) {
          // Remove from open graphs
          draft.openGraphIds = draft.openGraphIds.filter(id => id !== graphId);

          // Remove from expanded graphs
          draft.expandedGraphIds.delete(graphId);

          // Clear active graph if it was this one
          if (draft.activeGraphId === graphId) {
            draft.activeGraphId = draft.openGraphIds.length > 0 ? draft.openGraphIds[0] : null;
          }

          // Remove from right panel tabs if open
          draft.rightPanelTabs = draft.rightPanelTabs.filter(tab =>
            tab.type !== 'graph' || tab.graphId !== graphId
          );

          // Delete all edges in this graph
          if (graph.edgeIds) {
            graph.edgeIds.forEach(edgeId => {
              draft.edges.delete(edgeId);
            });
          }

          // Delete the graph
          draft.graphs.delete(graphId);
          console.log(`[Store cleanupOrphanedGraphs] Deleted orphaned graph: ${graphId}`);
        }
      });

      console.log(`[Store cleanupOrphanedGraphs] Cleanup complete. Deleted ${orphanedGraphs.length} orphaned graphs.`);
    })),

    // ─── HISTORY & UNDO/REDO ─────────────────────────────────────────────────────

    /**
     * Applies Immer inverse patches to revert or redo a state change.
     * Used by the history store's undo/redo system.
     *
     * @param {import('immer').Patch[]} patches - Immer patches to apply.
     */
    applyPatches: (patches) => set((state) => applyPatches(state, patches)),

    // ─── WIZARD / AGENT STATE ─────────────────────────────────────────────────────

    /**
     * Saves a wizard execution plan for a conversation/tab, persisting across LLM context clears.
     *
     * @param {string} conversationId - Conversation or tab ID.
     * @param {Object[]} plan - Array of plan step objects.
     * @param {string|null} graphId - Graph the plan is scoped to.
     */
    setWizardPlanForConversation: (conversationId, plan, graphId) => set((state) => ({
      wizardPlansByConversation: {
        ...state.wizardPlansByConversation,
        [conversationId]: { steps: plan, graphId: graphId || null }
      }
    })),
    /**
     * Removes the wizard plan for a conversation/tab.
     * @param {string} conversationId - Conversation or tab ID whose plan to clear.
     */
    clearWizardPlanForConversation: (conversationId) => set((state) => {
      const next = { ...state.wizardPlansByConversation };
      delete next[conversationId];
      return { wizardPlansByConversation: next };
    }),

    /**
     * Reverts a specific wizard-authored action by applying its inverse Immer patches.
     * Records the revert itself as a history entry.
     *
     * @param {string} actionId - ID of the wizard action to revert (from historyStore).
     */
    revertWizardAction: (actionId) => {
      const historyStore = useHistoryStore.getState();
      const action = historyStore.history.find(h => h.actionId === actionId);

      if (!action || !action.inversePatches) {
        console.warn(`[GraphStore] Could not find wizard action ${actionId} to revert`);
        return;
      }

      console.log(`[GraphStore] Reverting Wizard Action: ${action.description}`);

      // Push a dedicated history event for reverting
      api.setChangeContext({ type: 'wizard_revert', target: 'graph', isWizard: true, actionId: `${actionId}_revert` });

      set((state) => {
        return applyPatches(state, action.inversePatches);
      });
    },

  }; // End of returned state and actions object
})); // End of create function with middleware

// ─── SELECTORS ────────────────────────────────────────────────────────────────
// Selector factories for use with `useGraphStore(selector)`.

/** @param {string} id @returns {function(GraphState): GraphData|undefined} */
export const getGraphDataById = (id) => (state) => state.graphs.get(id);
/** @param {string} id @returns {function(GraphState): NodePrototype|undefined} */
export const getNodePrototypeById = (id) => (state) => state.nodePrototypes.get(id);
/** @param {string} id @returns {function(GraphState): EdgeData|undefined} */
export const getEdgeDataById = (id) => (state) => state.edges.get(id);

/** Returns the currently active graph's data. */
export const getActiveGraphData = (state) => state.graphs.get(state.activeGraphId);

/**
 * Returns all NodeInstance objects in a graph as an array.
 * @param {string} graphId
 * @returns {function(GraphState): NodeInstance[]}
 */
export const getInstancesForGraph = (graphId) => (state) => {
  const graph = state.graphs.get(graphId);
  if (!graph || !graph.instances) return [];
  return Array.from(graph.instances.values());
};

/**
 * Returns hydrated node objects combining instance position data with prototype metadata.
 * Used by NodeCanvas for rendering. Returns null entries for instances with missing prototypes.
 *
 * @param {string} graphId
 * @returns {function(GraphState): Array<{id: string, x: number, y: number, scale: number, name: string, color: string, ...}|null>}
 */
export const getHydratedNodesForGraph = (graphId) => (state) => {
  const graph = state.graphs.get(graphId);
  if (!graph || !graph.instances) return [];

  return Array.from(graph.instances.values()).map(instance => {
    const prototype = state.nodePrototypes.get(instance.prototypeId);
    if (!prototype) return null;
    return {
      ...prototype, // Spread prototype properties (name, color, etc.)
      ...instance, // Spread instance properties (id, x, y, scale), overwriting prototype id with instanceId
    };
  }).filter(Boolean); // Filter out any cases where prototype might be missing
};


// Returns EdgeData objects for a given graph ID
export const getEdgesForGraph = (graphId) => (state) => {
  const graph = state.graphs.get(graphId);
  if (!graph || !graph.edgeIds) return [];
  return graph.edgeIds.map(edgeId => state.edges.get(edgeId)).filter(Boolean);
};

// This selector is likely no longer needed or needs to be re-thought.
// It was for finding nodes within a definition graph based on a parent.
export const getNodesByParent = (parentId) => (state) => {
  const nodes = [];
  for (const nodeData of state.nodePrototypes.values()) {
    // This logic is probably incorrect with the new model.
    // if (nodeData.parentDefinitionNodeId === parentId) {
    //     nodes.push(nodeData);
    // }
  }
  return nodes;
};

// Returns the graph name (title)
export const getGraphTitleById = (graphId) => (state) => {
  const graphData = state.graphs.get(graphId);
  return graphData?.name || null; // Return name directly from data
};

export const getOpenGraphIds = (state) => state.openGraphIds;
export const getActiveGraphId = (state) => state.activeGraphId;

// Selector to check if a node is bookmarked
export const isNodeSaved = (nodeId) => (state) => state.savedNodeIds.has(nodeId);
export const isGraphSaved = (graphId) => (state) => state.savedGraphIds.has(graphId);
export const getNodeTypesInHierarchy = (nodeId) => (state) => {
  const types = [];
  let currentId = nodeId;
  const visited = new Set();

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const node = state.nodePrototypes.get(currentId);
    if (node) {
      types.push(node);
      currentId = node.typeNodeId;
    } else {
      break;
    }
  }

  return types;
};

// Export the store hook
export default useGraphStore;

// ===========================================================================
// HMR state preservation
// ---------------------------------------------------------------------------
// In Vite dev (electron:dev / vite dev), editing this module triggers HMR.
// Without explicit handling, the new module instance starts with default
// empty state, and any subscribers from the old instance see the data
// disappear from under them — which can lead to the SaveCoordinator
// snapshotting an empty state and overwriting the user's file.
//
// We:
//   1) Cache the current state into `import.meta.hot.data` on dispose
//   2) Restore it into the freshly-created store on the next module init
//   3) Re-emit a `load` change context so the SaveCoordinator's data-loss
//      guard treats this as a real load and unblocks saves with a correct
//      baseline (instead of seeing default empty state)
// ===========================================================================
if (typeof import.meta !== 'undefined' && import.meta.hot) {
  try {
    const cached = import.meta.hot.data?.graphStoreState;
    if (cached) {
      try {
        useGraphStore.setState(cached, false);
        // Re-establish baseline in SaveCoordinator. We do this lazily so we
        // don't pull in SaveCoordinator at module top-level (it has its own
        // HMR concerns).
        Promise.resolve().then(async () => {
          try {
            const { saveCoordinator } = await import('../backend/sync/index.js');
            if (saveCoordinator?.onStateChange) {
              saveCoordinator.onStateChange(useGraphStore.getState(), { type: 'load' });
            }
          } catch (_) { /* best-effort */ }
        });
        console.log('[graphStore HMR] Restored prior state across hot reload');
      } catch (e) {
        console.warn('[graphStore HMR] Failed to restore state:', e);
      }
    }

    import.meta.hot.dispose((data) => {
      try {
        // Snapshot the current state so the next module instance can adopt it.
        // Maps and Sets serialize as references in the HMR data dict, which is
        // exactly what we need (in-memory transfer, no JSON round-trip).
        data.graphStoreState = useGraphStore.getState();
      } catch (e) {
        console.warn('[graphStore HMR] Failed to capture state before reload:', e);
      }
    });
  } catch (e) {
    console.warn('[graphStore HMR] HMR setup failed:', e);
  }
}

// Auto-save is now handled by the fileStorage module directly with enableAutoSave()
// This file has been refactored to use a prototype/instance model.
// - The global `nodes` map is now `nodePrototypes`.
// - `Graph` objects contain an `instances` map instead of `nodeIds`.
// - Actions now operate on `nodePrototypes` and `instances` separately.
// - Edges connect `instanceId`s.
// - Selectors have been updated to provide data in the new format.

// Auto-save is now handled by the fileStorage module directly with enableAutoSave() 
