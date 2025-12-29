import { create } from 'zustand';
import { produce, enableMapSet } from 'immer';
import { v4 as uuidv4 } from 'uuid';
import { NODE_WIDTH, NODE_HEIGHT, NODE_DEFAULT_COLOR } from '../constants.js';
import { getFileStatus, restoreLastSession, clearSession, notifyChanges } from './fileStorage.js';
import { importFromRedstring } from '../formats/redstringFormat.js';
import { MAX_LAYOUT_SCALE_MULTIPLIER } from '../services/graphLayoutService.js';

// Enable Immer Map/Set plugin support
enableMapSet();

const getDefaultAutoLayoutSettings = () => ({
  defaultSpacing: 15,
  nodeClearance: 20,
  enableAutoRouting: true,
  showConnectionLabels: true,
  routingStyle: 'straight',
  manhattanBends: 'auto',
  cleanLaneSpacing: 200,
  layoutScale: 'balanced',
  layoutScaleMultiplier: 1,
  layoutIterations: 'balanced',
  groupLayoutAlgorithm: 'node-driven',
  showClusterHulls: false // Debug visualization for connectivity clusters
});

const getDefaultForceTunerSettings = () => ({
  layoutScale: 'balanced',
  layoutScaleMultiplier: 1,
  layoutIterations: 'balanced',
  // Individual force parameters
  repulsionStrength: 500000,
  attractionStrength: 0.2,
  linkDistance: 400,
  minLinkDistance: 250,
  centerStrength: 0.015,
  collisionRadius: 80,
  edgeAvoidance: 0.5,
  alphaDecay: 0.015,
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
  const newGraphName = prototype.name || 'Untitled Definition';

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

  return (set, get, api) => {
    // Enhance the set function to track change context
    const enhancedSet = (...args) => {
      set(...args);

      // Batch multiple rapid state changes into a single notification
      // This prevents excessive hash calculations during rapid operations
      if (pendingNotification) {
        clearTimeout(pendingNotification);
      }

      // Merge context from multiple rapid changes
      batchedContext = { ...batchedContext, ...changeContext };

      // Notify SaveCoordinator of state changes with micro-batching
      pendingNotification = setTimeout(async () => {
        try {
          const coordinator = await getSaveCoordinator();
          if (coordinator && coordinator.isEnabled) {
            const currentState = get();
            coordinator.onStateChange(currentState, batchedContext);
          }

          // Reset contexts for next batch
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
      if (savedMode && ['closed', 'node', 'connection'].includes(savedMode)) {
        return savedMode;
      } else {
        return 'connection'; // Default order: connections -> nodes -> closed
      }
    })(),
    rightPanelTabs: [{ type: 'home', isActive: true }],
    expandedGraphIds: new Set(),
    savedNodeIds: new Set(), // This now refers to prototype IDs
    savedGraphIds: new Set(), // This is based on the defining prototype ID

    // Universe file state
    isUniverseLoaded: false,
    isUniverseLoading: true, // Start in loading state
    universeLoadingError: null,
    hasUniverseFile: false,
    _isLoadingUniverse: false, // Internal lock to prevent concurrent loads

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
    showConnectionNames: false,
    // Grid visualization settings
    gridSettings: (() => {
      try {
        const modeRaw = localStorage.getItem('redstring_grid_mode');
        const sizeRaw = localStorage.getItem('redstring_grid_size');
        const allowed = new Set(['off', 'hover', 'always']);
        const mode = allowed.has(modeRaw) ? modeRaw : 'off';
        let size = Number.parseInt(sizeRaw, 10);
        if (!Number.isFinite(size)) size = 200;
        size = Math.max(20, Math.min(400, Math.round(size)));
        return { mode, size };
      } catch (_) {
        return { mode: 'off', size: 200 };
      }
    })(),
    // Connections visualization/layout settings
    autoLayoutSettings: getDefaultAutoLayoutSettings(),
    forceTunerSettings: getDefaultForceTunerSettings(),

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
    gitSyncEngine: null, // Will be set by GitNativeFederation component
    gitSourceOfTruth: (() => {
      // Load saved source of truth from localStorage
      const saved = localStorage.getItem('redstring_git_source_of_truth');
      return saved === 'git' ? 'git' : 'local'; // Default to 'local'
    })(),

    // --- Actions --- (Operating on plain data)
    // Grouping actions
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

    updateGroup: (graphId, groupId, recipe, contextOptions = {}) => {
      api.setChangeContext({ type: 'group_update', target: 'group', ...contextOptions });
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

    deleteGroup: (graphId, groupId, contextOptions = {}) => {
      api.setChangeContext({ type: 'group_delete', target: 'group', ...contextOptions });
      return set(produce((draft) => {
        const graph = draft.graphs.get(graphId);
        if (!graph?.groups) return;
        graph.groups.delete(groupId);
      }));
    },

    // Convert a regular group to a node-group (linked to a node prototype definition)
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
          name: prototype.name || 'Untitled Definition',
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

        console.log(`[convertGroupToNodeGroup] Converted group ${groupId} to node-group linked to prototype ${prototypeId}, definition ${definitionIndex}`);
      }));
    },


    // This action is deprecated. All loading now goes through loadUniverseFromFile.
    loadGraph: (graphInstance) => { },

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
          // If no members, try to reuse group's stored centroid if available
          position = {
            x: group.position?.x ?? 0,
            y: group.position?.y ?? 0
          };
        }

        const newInstanceId = uuidv4();
        createdInstanceId = newInstanceId;

        if (!graph.instances) {
          graph.instances = new Map();
        }
        graph.instances.set(newInstanceId, {
          id: newInstanceId,
          prototypeId: group.linkedNodePrototypeId,
          x: position.x,
          y: position.y,
          scale: 1
        });

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
            edge.sourceId = newInstanceId;
            if (arrowsToward.has(oldSource)) {
              arrowsToward.delete(oldSource);
              arrowsToward.add(newInstanceId);
            }
          }

          if (destInGroup) {
            const oldDest = edge.destinationId;
            edge.destinationId = newInstanceId;
            if (arrowsToward.has(oldDest)) {
              arrowsToward.delete(oldDest);
              arrowsToward.add(newInstanceId);
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

    // Adds a NEW plain prototype data to the global pool.
    addNodePrototype: (prototypeData) => {
      api.setChangeContext({ type: 'prototype_create', target: 'prototype' });
      return set(produce((draft) => {
        const prototypeId = prototypeData.id || uuidv4();
        if (!draft.nodePrototypes.has(prototypeId)) {
          const createdAt = prototypeData.createdAt || new Date().toISOString();
          // Ensure agentConfig defaults to null if not provided
          const agentConfig = prototypeData.agentConfig !== undefined ? prototypeData.agentConfig : null;
          draft.nodePrototypes.set(prototypeId, { ...prototypeData, id: prototypeId, createdAt, agentConfig });
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

    // Adds a node prototype with duplicate detection by name
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

    // Find potential duplicate nodes based on name similarity
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

    // Merge two node prototypes
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

      // Update all instances that reference the secondary prototype
      for (const graph of draft.graphs.values()) {
        if (graph.instances) {
          for (const instance of graph.instances.values()) {
            if (instance.prototypeId === secondaryId) {
              instance.prototypeId = primaryId;
            }
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

      // Remap right panel tabs referencing the secondary prototype
      if (Array.isArray(draft.rightPanelTabs)) {
        draft.rightPanelTabs.forEach(tab => {
          if (tab && tab.type === 'node' && tab.nodeId === secondaryId) {
            tab.nodeId = primaryId;
            if (primary?.name) tab.title = primary.name;
          }
        });
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

    // Merge definition graphs with options
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

    // Duplicate a node prototype for testing
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

    // Adds a new instance of a prototype to a specific graph.
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

    // Remove instance immediately (hard delete) and clean up connected edges
    removeNodeInstance: (graphId, instanceId) => set(produce((draft) => {
      const graph = draft.graphs.get(graphId);
      if (!graph || !graph.instances?.has(instanceId)) {
        console.warn(`[removeNodeInstance] Instance ${instanceId} not found in graph ${graphId}.`);
        return;
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

      // Ensure any soft-deletion bookkeeping is cleared
      draft.pendingDeletions.delete(instanceId);

      console.log(`[removeNodeInstance] Permanently deleted instance ${instanceId} and ${edgesToDelete.length} connected edges`);
    })),

    // Immediately and permanently deletes a node instance (bypasses grace period)
    forceDeleteNodeInstance: (graphId, instanceId) => set(produce((draft) => {
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
    })),

    // Restores a node instance from pending deletion
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

    // Cleanup expired pending deletions
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

    // Update a prototype's data using Immer's recipe. This affects all its instances.
    updateNodePrototype: (prototypeId, recipe) => {
      api.setChangeContext({ type: 'prototype_change', target: 'prototype' });
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

    // Update an instance's unique data (e.g., position)
    updateNodeInstance: (graphId, instanceId, recipe, contextOptions = {}) => {
      api.setChangeContext({ type: 'node_position', target: 'instance', ...contextOptions });
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

    // Update positions of multiple instances efficiently
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

    // Adds a NEW edge connecting two instances.
    addEdge: (graphId, newEdgeData, contextOptions = {}) => {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/52d0fe28-158e-49a4-b331-f013fcb14181',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'graphStore.jsx:addEdge',message:'addEdge called',data:{graphId,edgeId:newEdgeData?.id,sourceId:newEdgeData?.sourceId,destId:newEdgeData?.destinationId,stack:new Error().stack?.split('\n').slice(1,5)},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'A-B'})}).catch(()=>{});
      // #endregion
      api.setChangeContext({ type: 'edge_create', target: 'edge', finalize: true, ...contextOptions });
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
        fetch('http://127.0.0.1:7242/ingest/52d0fe28-158e-49a4-b331-f013fcb14181',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'graphStore.jsx:addEdge:check',message:'Checking existing edges',data:{edgeId,sourceId:sourceInstanceId,destId:destInstanceId,existingEdgeCount:existingEdges.length,existingEdgeIds:existingEdges.map(e=>e.id)},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'B'})}).catch(()=>{});
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
          fetch('http://127.0.0.1:7242/ingest/52d0fe28-158e-49a4-b331-f013fcb14181',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'graphStore.jsx:addEdge:created',message:'Edge created',data:{edgeId,totalEdgesNow:graph.edgeIds.length},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'A-B'})}).catch(()=>{});
          // #endregion
        } else {
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/52d0fe28-158e-49a4-b331-f013fcb14181',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'graphStore.jsx:addEdge:skip',message:'Edge already exists - skipped',data:{edgeId},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'A'})}).catch(()=>{});
          // #endregion
        }
      }));
    },

    // Update an edge's data using Immer's recipe (no change needed here)
    updateEdge: (edgeId, recipe) => set(produce((draft) => {
      const edge = draft.edges.get(edgeId);
      if (edge) {
        recipe(edge); // Apply the Immer updates
      } else {
        console.warn(`updateEdge: Edge with id ${edgeId} not found.`);
      }
    })),

    // Set the type of a node (the node that serves as this node's type in the abstraction hierarchy)
    setNodeType: (nodeId, typeNodeId) => set(produce((draft) => {
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
    })),

    // Edge prototype management
    addEdgePrototype: (prototypeData) => set(produce((draft) => {
      const prototypeId = prototypeData.id || uuidv4();
      if (!draft.edgePrototypes.has(prototypeId)) {
        draft.edgePrototypes.set(prototypeId, { ...prototypeData, id: prototypeId });
      }
    })),

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

    // Set the type of an edge
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


    // --- Tab Management Actions --- (Unaffected by prototype change)
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

    closeGraphTab: (graphId) => set(produce((draft) => {
      draft.openGraphIds = draft.openGraphIds.filter(id => id !== graphId);
      if (draft.activeGraphId === graphId) {
        draft.activeGraphId = draft.openGraphIds.length > 0 ? draft.openGraphIds[0] : null;
      }
    })),

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

    // Creates a new, empty graph and sets it as active
    // Batch multiple graph updates in one transaction
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

        // 1. Add nodes
        nodes.forEach(node => {
          const protoId = node.prototypeId || uuidv4();
          const instanceId = node.instanceId || uuidv4();

          // Add prototype if it doesn't exist
          if (!draft.nodePrototypes.has(protoId)) {
            draft.nodePrototypes.set(protoId, {
              id: protoId,
              name: node.name,
              color: node.color || NODE_DEFAULT_COLOR,
              description: node.description || '',
              createdAt: new Date().toISOString()
            });
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
            if (!draft.edges.has(edgeId)) {
              const edgeData = {
                id: edgeId,
                sourceId: sourceId,
                destinationId: destId,
                type: edge.type || 'relates to',
                typeNodeId: edge.typeNodeId || 'base-connection-prototype',
                directionality: normalizeEdgeDirectionality(edge.directionality)
              };
              draft.edges.set(edgeId, edgeData);
              if (!graph.edgeIds) graph.edgeIds = [];
              graph.edgeIds.push(edgeId);
              console.log(`[applyBulkGraphUpdates] Created edge: ${edge.source || 'unknown'} → ${edge.target || 'unknown'} (${edge.type})`);
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

        console.log(`[Store] Created and activated new empty graph: ${newGraphId} ('${newGraphName}') defined by prototype ${definingPrototypeId}.`);
      }));
      return newGraphId; // Return the actual graph ID that was created
    },

    // Deterministic graph creation with provided id (no-op if exists)
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

    // Creates a new graph, assigns it as a definition to a prototype, and makes it active
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

    // Creates a new graph and assigns it as a definition, but does NOT make it active.
    createAndAssignGraphDefinitionWithoutActivation: (prototypeId) => {
      let newGraphId = null;
      set(produce((draft) => {
        newGraphId = _createAndAssignGraphDefinition(draft, prototypeId);
        if (!newGraphId) return;

        console.log(`[Store createAndAssignGraphDefinitionWithoutActivation] Created new graph ${newGraphId} for prototype ${prototypeId}.`);
      }));
      return newGraphId;
    },

    // Sets the currently active graph tab.
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

    // Updates specific properties of a graph
    updateGraph: (graphId, updateFn) => set(produce((draft) => {
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
    })),

    // --- Right Panel Tab Management Actions ---
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
    })),

    activateRightPanelTab: (index) => set(produce((draft) => {
      if (index < 0 || index >= draft.rightPanelTabs.length) {
        console.warn(`activateRightPanelTab: Tab index ${index} out of bounds.`);
        return;
      }

      // Set all tabs to inactive, then activate the selected tab
      draft.rightPanelTabs.forEach(tab => { tab.isActive = false; });
      draft.rightPanelTabs[index].isActive = true;
    })),

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

    // <<< Add action to toggle expanded state >>>
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

    // Toggle node bookmark status in savedNodeIds set
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

    // Toggle graph bookmark status by saving/unsaving its defining node
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
          name: graph.name || 'Untitled Graph',
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

    // Toggle connection names visibility
    toggleShowConnectionNames: () => set(produce((draft) => {
      draft.showConnectionNames = !draft.showConnectionNames;
    })),

    // Grid settings actions
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

    // Toggle global auto-routing enablement
    toggleEnableAutoRouting: () => set(produce((draft) => {
      if (!draft.autoLayoutSettings) {
        draft.autoLayoutSettings = getDefaultAutoLayoutSettings();
      }
      draft.autoLayoutSettings.enableAutoRouting = !draft.autoLayoutSettings.enableAutoRouting;
    })),

    // Set the global routing style
    setGroupLayoutAlgorithm: (algorithm) => set(produce((draft) => {
      if (!draft.autoLayoutSettings) {
        draft.autoLayoutSettings = getDefaultAutoLayoutSettings();
      }
      draft.autoLayoutSettings.groupLayoutAlgorithm = algorithm;
      console.log(`[Store] Group layout algorithm set to: ${algorithm}`);
    })),

    toggleShowClusterHulls: () => set(produce((draft) => {
      if (!draft.autoLayoutSettings) {
        draft.autoLayoutSettings = getDefaultAutoLayoutSettings();
      }
      draft.autoLayoutSettings.showClusterHulls = !draft.autoLayoutSettings.showClusterHulls;
      console.log(`[Store] Show cluster hulls set to: ${draft.autoLayoutSettings.showClusterHulls}`);
    })),

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

    // Set number of bends preference for Manhattan routing
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

    // Set lane spacing for clean routing
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


    // Explicitly set active definition node (e.g., when switching graphs)
    setActiveDefinitionNode: (nodeId) => {
      console.log(`[Store Action] Explicitly setting activeDefinitionNodeId to: ${nodeId}`);
      set({ activeDefinitionNodeId: nodeId });
    },

    // Set the currently selected edge for editing
    setSelectedEdgeId: (edgeId) => {
      console.log(`[Store Action] Setting selectedEdgeId to: ${edgeId}`);
      set({ selectedEdgeId: edgeId });
    },

    // Set multiple selected edges
    setSelectedEdgeIds: (edgeIds) => {
      console.log(`[Store Action] Setting selectedEdgeIds to:`, edgeIds);
      set({ selectedEdgeIds: new Set(edgeIds) });
    },

    // Add edge to selection
    addSelectedEdgeId: (edgeId) => set(produce((draft) => {
      draft.selectedEdgeIds.add(edgeId);
      console.log(`[Store Action] Added edge ${edgeId} to selection`);
    })),

    // Remove edge from selection
    removeSelectedEdgeId: (edgeId) => set(produce((draft) => {
      draft.selectedEdgeIds.delete(edgeId);
      console.log(`[Store Action] Removed edge ${edgeId} from selection`);
    })),

    // Clear all selected edges
    clearSelectedEdgeIds: () => set(produce((draft) => {
      draft.selectedEdgeIds.clear();
      console.log(`[Store Action] Cleared all selected edges`);
    })),

    // Set TypeList mode
    setTypeListMode: (mode) => {
      console.log(`[Store Action] Setting typeListMode to: ${mode}`);
      set({ typeListMode: mode });
    },

    // Set the type of a node prototype (duplicate removed; use earlier guarded version)

    // Remove a definition graph from a node and delete the graph if it's no longer referenced
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

    // Open a graph tab and bring it to the top (similar to Panel.jsx double-click behavior)
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

    // Clean up orphaned nodes and graphs that are no longer referenced
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

      console.log(`[Store cleanupOrphanedData] Cleanup complete. Removed ${orphanedPrototypes.length} prototypes, ${orphanedGraphs.length} graphs, ${orphanedEdges.length} edges.`);
    })),

    // Restore from last session (automatic) - now only returns universe file data
    restoreFromSession: async () => {
      try {
        const result = await restoreLastSession();
        return result; // Return the result object for the component to handle
      } catch (error) {
        console.error('[Store] Error restoring from session:', error);
        return { success: false, error: error.message };
      }
    },

    // Get file status
    getFileStatus: () => getFileStatus(),

    // Universe file management actions
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
          // Use the centralized import function to correctly deserialize the data
          const { storeState: importedState, errors } = importFromRedstring(dataToLoad);
          if (errors && errors.length > 0) {
            console.error("[graphStore] Errors importing from Redstring:", errors);
            // Don't return here, continue with the imported state even if there were errors
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

        set({
          ...storeState,
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

    setUniverseError: (error) => set({
      isUniverseLoaded: true, // Loading is complete, but with an error
      isUniverseLoading: false,
      universeLoadingError: error,
      hasUniverseFile: false
    }),

    // --- Simple Abstraction Actions ---

    // Add a node above (more specific) or below (more general) in a dimension chain
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

    // Remove a node from an abstraction chain
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

    // Replace a node in the canvas with one from the abstraction chain
    swapNodeInChain: (currentNodeId, newNodeId) => set(produce((draft) => {
      // This will be used by the swap button in the carousel
      // For now, just log the action - the actual swap will happen in the UI layer
      console.log(`Swapping ${currentNodeId} with ${newNodeId}`);
    })),

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

    setUniverseConnected: (hasFile = true) => set(state => ({
      ...state,
      hasUniverseFile: hasFile
    })),

    setUniverseLoaded: (loaded = true, hasFile = true) => set(state => ({
      ...state,
      isUniverseLoaded: loaded,
      isUniverseLoading: false,
      hasUniverseFile: hasFile,
      universeLoadingError: null
    })),

    // Storage mode actions
    setStorageMode: (mode) => set(state => ({
      ...state,
      storageMode: mode
    })),
    updateGitSettings: (settings) => set(state => ({
      ...state,
      gitSettings: { ...state.gitSettings, ...settings }
    })),

    updateGraphView: (graphId, panOffset, zoomLevel) => {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/52d0fe28-158e-49a4-b331-f013fcb14181',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'graphStore.jsx:2917',message:'updateGraphView called',data:{graphId,zoomLevel:zoomLevel?.toFixed?.(3)},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'C'})}).catch(()=>{});
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

    // Git Federation Actions
    setGitConnection: (connectionConfig) => {
      set(produce((draft) => {
        draft.gitConnection = connectionConfig;
        // Persist to localStorage
        localStorage.setItem('redstring_git_connection', JSON.stringify(connectionConfig));
      }));
    },

    clearGitConnection: () => {
      set(produce((draft) => {
        draft.gitConnection = null;
        draft.gitSyncEngine = null;
        // Clear from localStorage
        localStorage.removeItem('redstring_git_connection');
      }));
    },

    setGitSyncEngine: (syncEngine) => {
      set(produce((draft) => {
        draft.gitSyncEngine = syncEngine;
      }));
    },

    setGitSourceOfTruth: (sourceOfTruth) => {
      set(produce((draft) => {
        draft.gitSourceOfTruth = sourceOfTruth;
        // Persist to localStorage
        localStorage.setItem('redstring_git_source_of_truth', sourceOfTruth);
      }));
    },

    // Delete a node prototype and all its related data
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

    // Delete a graph and all its related data
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

    // Clean up any orphaned graphs that reference non-existent prototypes
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

  }; // End of returned state and actions object
})); // End of create function with middleware

// --- Selectors --- (Return plain data, add edge selector)

export const getGraphDataById = (id) => (state) => state.graphs.get(id);
export const getNodePrototypeById = (id) => (state) => state.nodePrototypes.get(id);
export const getEdgeDataById = (id) => (state) => state.edges.get(id);

export const getActiveGraphData = (state) => state.graphs.get(state.activeGraphId);

// Returns NodeInstance objects for a given graph ID
export const getInstancesForGraph = (graphId) => (state) => {
  const graph = state.graphs.get(graphId);
  if (!graph || !graph.instances) return [];
  return Array.from(graph.instances.values());
};

// Returns fully hydrated node objects (instance + prototype data) for rendering
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

// Auto-save is now handled by the fileStorage module directly with enableAutoSave()
// This file has been refactored to use a prototype/instance model.
// - The global `nodes` map is now `nodePrototypes`.
// - `Graph` objects contain an `instances` map instead of `nodeIds`.
// - Actions now operate on `nodePrototypes` and `instances` separately.
// - Edges connect `instanceId`s.
// - Selectors have been updated to provide data in the new format.

// Auto-save is now handled by the fileStorage module directly with enableAutoSave() 
