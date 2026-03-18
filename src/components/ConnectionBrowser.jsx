import React, { useState, useEffect, useMemo, useRef } from 'react';
import { ArrowRight, Plus, CircleDot, RefreshCw, List, Network, Sparkles, Search, X } from 'lucide-react';
import useGraphStore from '../store/graphStore.jsx';
import { discoverConnections } from '../services/semanticDiscovery.js';
import { fastEnrichFromSemanticWeb } from '../services/semanticWebQuery.js';
import Dropdown from './Dropdown.jsx';
import { getTextColor } from '../utils/colorUtils.js';
import { useTheme } from '../hooks/useTheme.js';
import './ConnectionBrowser.css';

/**
 * Connection Browser Component
 * Shows connections with dropdown: In Graph | Universe | Semantic Web
 */
const ConnectionBrowser = ({ nodeData, onMaterializeConnection, isUltraSlim = false }) => {
  const theme = useTheme();
  const [connectionScope, setConnectionScope] = useState('graph'); // 'graph' | 'universe' | 'semantic'
  const [semanticConnections, setSemanticConnections] = useState([]);
  const [nativeConnections, setNativeConnections] = useState([]);
  const [isLoadingSemanticWeb, setIsLoadingSemanticWeb] = useState(false);
  const [isDebouncing, setIsDebouncing] = useState(false); // Track debounce state
  const [error, setError] = useState(null);
  const [containerWidth, setContainerWidth] = useState(400); // Default width
  const [searchFilter, setSearchFilter] = useState(''); // Search filter
  const [minConfidence, setMinConfidence] = useState(0); // Confidence filter for semantic connections


  const { activeGraphId, nodePrototypes, graphs, edges } = useGraphStore();

  // Measure container width for responsive text hiding
  useEffect(() => {
    const updateContainerWidth = () => {
      if (connectionListRef.current) {
        const width = connectionListRef.current.offsetWidth;
        setContainerWidth(width);
      }
    };

    // Initial measurement
    updateContainerWidth();

    // Update on window resize
    window.addEventListener('resize', updateContainerWidth);

    // Use ResizeObserver for more accurate measurements
    let resizeObserver;
    if (connectionListRef.current && window.ResizeObserver) {
      resizeObserver = new ResizeObserver(updateContainerWidth);
      resizeObserver.observe(connectionListRef.current);
    }

    return () => {
      window.removeEventListener('resize', updateContainerWidth);
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
    };
  }, []);

  // Load semantic web connections from new discovery system (with debouncing!)
  useEffect(() => {
    if (!nodeData?.name || nodeData.name.trim() === '') {
      console.log('[ConnectionBrowser] No valid node name, skipping semantic web connection load');
      setSemanticConnections([]);
      setIsDebouncing(false);
      return;
    }

    // Show debouncing indicator immediately
    setIsDebouncing(true);

    // Debounce the query - wait 800ms after user stops typing
    const debounceTimer = setTimeout(() => {
      setIsDebouncing(false); // Done debouncing, now loading

      const loadSemanticConnections = async () => {
        setIsLoadingSemanticWeb(true);
        setError(null);

        try {
          console.log(`[ConnectionBrowser] Discovering connections for: "${nodeData.name}"`);

          // Use new property-path discovery system (FAST!)
          const discoveryResults = await discoverConnections(nodeData.name, {
            timeout: 12000, // 12 seconds (faster than old system)
            limit: 25,
            minConfidence: 0.5,
            sources: ['dbpedia', 'wikidata']
          });

          // Convert discovery results to connection format with CLEAR LABELS
          const federatedConnections = discoveryResults.connections.map((conn, index) => ({
            id: `disc-${index}`,
            subject: conn.source,
            predicate: conn.relation, // This is the key! "developer", "genre", etc.
            object: conn.target,
            confidence: conn.confidence,
            source: conn.provider,
            type: 'semantic',
            description: conn.description,
            relationUri: conn.relationUri,
            targetUri: conn.targetUri
          }));

          console.log(`[ConnectionBrowser] Discovered ${federatedConnections.length} connections with labels:`);
          federatedConnections.forEach(conn => {
            console.log(`  ${conn.subject} → ${conn.predicate} → ${conn.object} (${(conn.confidence * 100).toFixed(0)}%)`);
          });

          setSemanticConnections(federatedConnections);

        } catch (err) {
          console.error('[ConnectionBrowser] Discovery failed, falling back to enrichment:', err);

          // Fallback to old system if new one fails
          try {
            const enrichmentResults = await fastEnrichFromSemanticWeb(nodeData.name, {
              timeout: 10000
            });

            const fallbackConnections = [];

            if (enrichmentResults.sources.wikidata?.found) {
              fallbackConnections.push({
                id: 'fb-wikidata',
                subject: nodeData.name,
                predicate: 'found in',
                object: 'Wikidata',
                confidence: 0.9,
                source: 'wikidata',
                type: 'semantic'
              });
            }

            if (enrichmentResults.sources.dbpedia?.found) {
              fallbackConnections.push({
                id: 'fb-dbpedia',
                subject: nodeData.name,
                predicate: 'found in',
                object: 'DBpedia',
                confidence: 0.9,
                source: 'dbpedia',
                type: 'semantic'
              });
            }

            setSemanticConnections(fallbackConnections);
          } catch (fallbackErr) {
            console.error('[ConnectionBrowser] Fallback also failed:', fallbackErr);
            setError('Unable to load connections from semantic web');
            setSemanticConnections([]);
          }
        } finally {
          setIsLoadingSemanticWeb(false);
        }
      };

      loadSemanticConnections();
    }, 800); // Wait 800ms after user stops typing

    // Cleanup: cancel the timeout if nodeData.name changes again
    return () => {
      clearTimeout(debounceTimer);
    };
  }, [nodeData?.name]);

  // Create a stable structural hash of the connection topology
  // This only changes when edges or instances are added/removed, not when positions change
  const connectionStructureHash = useMemo(() => {
    if (!nodeData?.id) return '';

    // Build a string representing the structure of connections
    const parts = [];

    // Include edge IDs from all graphs
    for (const [graphId, graph] of graphs.entries()) {
      if (graph.edgeIds && graph.edgeIds.length > 0) {
        parts.push(`g:${graphId}:${graph.edgeIds.join(',')}`);
      }

      // Include instance count for this prototype in each graph
      if (graph.instances) {
        let instanceCount = 0;
        for (const [instanceId, instance] of graph.instances.entries()) {
          if (instance.prototypeId === nodeData.id) {
            instanceCount++;
          }
        }
        if (instanceCount > 0) {
          parts.push(`i:${graphId}:${instanceCount}`);
        }
      }
    }

    // Include edge structure (source->dest pairs)
    for (const [edgeId, edge] of edges.entries()) {
      if (edge.sourceId && edge.destinationId) {
        parts.push(`e:${edgeId}:${edge.sourceId}->${edge.destinationId}`);
      }
    }

    return parts.sort().join('|');
  }, [nodeData?.id, graphs, edges]);

  // Load native Redstring connections for this node
  // Only recalculates when the connection STRUCTURE changes, not positions
  useEffect(() => {
    if (!nodeData?.id) {
      console.log('[ConnectionBrowser] No node ID, skipping native connection load');
      return;
    }

    const loadNativeConnections = () => {
      const connections = [];

      // Find all instances of this node prototype across all graphs
      const nodeInstances = [];
      for (const [graphId, graph] of graphs.entries()) {
        if (graph.instances) {
          for (const [instanceId, instance] of graph.instances.entries()) {
            if (instance.prototypeId === nodeData.id) {
              nodeInstances.push({
                instanceId,
                graphId,
                instance
              });
            }
          }
        }
      }

      // For each instance, find all edges connected to it
      for (const nodeInstance of nodeInstances) {
        const { instanceId, graphId, instance } = nodeInstance;
        const graph = graphs.get(graphId);

        if (graph?.edgeIds) {
          for (const edgeId of graph.edgeIds) {
            const edge = edges.get(edgeId);
            if (!edge) continue;

            let isSource = false;
            let isDestination = false;
            let connectedInstanceId = null;

            // Check if this instance is involved in the edge
            if (edge.sourceId === instanceId) {
              isSource = true;
              connectedInstanceId = edge.destinationId;
            } else if (edge.destinationId === instanceId) {
              isDestination = true;
              connectedInstanceId = edge.sourceId;
            }

            if (connectedInstanceId) {
              // Get the connected instance and its prototype
              const connectedInstance = graph.instances?.get(connectedInstanceId);
              const connectedPrototype = connectedInstance ? nodePrototypes.get(connectedInstance.prototypeId) : null;

              if (connectedInstance && connectedPrototype) {
                // Get edge prototype for the connection label and COLOR
                let connectionName = 'Connection';
                let connectionColor = '#8B0000'; // Default color

                // First try to get name and color from edge's definition node (if it has one)
                if (edge.definitionNodeIds && edge.definitionNodeIds.length > 0) {
                  const definitionNode = nodePrototypes.get(edge.definitionNodeIds[0]);
                  if (definitionNode) {
                    connectionName = definitionNode.name || 'Connection';
                    connectionColor = definitionNode.color || '#8B0000';
                  }
                } else if (edge.typeNodeId) {
                  // Fallback to edge prototype type
                  const edgePrototype = nodePrototypes.get(edge.typeNodeId);
                  if (edgePrototype) {
                    connectionName = edgePrototype.name || 'Connection';
                    connectionColor = edgePrototype.color || '#8B0000';
                  }
                }

                const connection = {
                  id: `native-${edgeId}`,
                  subject: isSource ? nodeData.name : connectedPrototype.name,
                  predicate: connectionName,
                  object: isSource ? connectedPrototype.name : nodeData.name,
                  confidence: 1.0, // Native connections have 100% confidence
                  source: 'redstring',
                  type: 'native',
                  graphId,
                  graphName: graph.name,
                  edgeId,
                  sourceInstanceId: edge.sourceId,
                  destinationInstanceId: edge.destinationId,
                  inCurrentGraph: graphId === activeGraphId,
                  directionality: edge.directionality || 'directed', // Include directionality info
                  isSource, // Track if current node is source or destination
                  connectedNodeId: connectedPrototype.id,
                  connectedNodeName: connectedPrototype.name,
                  connectionColor // Store the edge/connection color
                };

                connections.push(connection);
              }
            }
          }
        }
      }

      setNativeConnections(connections);
      console.log(`[ConnectionBrowser] Loaded ${connections.length} native connections for node ${nodeData.name}`);
    };

    loadNativeConnections();
  }, [nodeData?.id, connectionStructureHash, nodePrototypes, activeGraphId]);

  // Filter connections based on scope AND search/confidence filters
  const filteredConnections = useMemo(() => {
    let connections = [];

    switch (connectionScope) {
      case 'graph':
        // Show only native connections that are in the current active graph
        connections = nativeConnections.filter(conn => conn.inCurrentGraph);
        break;
      case 'universe':
        // Show all native connections across all graphs
        connections = nativeConnections;
        break;
      case 'semantic':
        // Show semantic web connections
        connections = semanticConnections;
        break;
      default:
        connections = [];
    }

    // Apply search filter (searches in predicate, subject, object)
    if (searchFilter.trim()) {
      const search = searchFilter.toLowerCase();
      connections = connections.filter(conn =>
        (conn.predicate?.toLowerCase() || '').includes(search) ||
        (conn.subject?.toLowerCase() || '').includes(search) ||
        (conn.object?.toLowerCase() || '').includes(search) ||
        (conn.description?.toLowerCase() || '').includes(search)
      );
    }

    // Apply confidence filter (only for semantic connections)
    if (connectionScope === 'semantic' && minConfidence > 0) {
      connections = connections.filter(conn =>
        (conn.confidence || 0) * 100 >= minConfidence
      );
    }

    return connections;
  }, [connectionScope, nativeConnections, semanticConnections, searchFilter, minConfidence]);

  // Get appropriate color for nodes based on existing prototypes
  const getNodeColor = (nodeName) => {
    // Check if a node with this name already exists in prototypes
    for (const [id, prototype] of nodePrototypes.entries()) {
      if (prototype.name.toLowerCase() === nodeName.toLowerCase()) {
        return prototype.color;
      }
    }
    return '#8B0000'; // Default maroon
  };

  const handleMaterializeConnection = (connection) => {
    if (onMaterializeConnection) {
      onMaterializeConnection({
        ...connection,
        subjectColor: getNodeColor(connection.subject),
        objectColor: getNodeColor(connection.object)
      });
    }
    console.log('[ConnectionBrowser] Materializing connection:', connection);
  };

  if (!nodeData) {
    return (
      <div className="connection-browser-empty">
        No node data available for connections
      </div>
    );
  }

  // Determine loading state based on current scope
  const isLoading = connectionScope === 'semantic' ? (isLoadingSemanticWeb || isDebouncing) : false;

  return (
    <div className="connection-browser">
      {/* Scope Dropdown */}
      <Dropdown
        options={[
          { value: 'graph', label: 'In Graph' },
          { value: 'universe', label: 'Universe' },
          { value: 'semantic', label: 'Semantic Web' }
        ]}
        value={connectionScope}
        onChange={setConnectionScope}
        rightContent={
          isLoading ? (
            <div className="loading-indicator">
              <RefreshCw size={12} className="spin" />
              <span>Loading...</span>
            </div>
          ) : (
            `${filteredConnections.length} connection${filteredConnections.length !== 1 ? 's' : ''}`
          )
        }
      />

      {/* Search & Filter Bar (only for semantic web) */}
      {connectionScope === 'semantic' && !isLoading && semanticConnections.length > 0 && (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          padding: '8px',
          backgroundColor: 'rgba(139, 0, 0, 0.05)',
          borderRadius: '6px',
          marginTop: '8px'
        }}>
          {/* Search Input */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Search size={14} color="#8B0000" />
            <input
              type="text"
              placeholder="Search connections, relationships..."
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              style={{
                flex: 1,
                padding: '6px 8px',
                border: '1px solid #8B0000',
                borderRadius: '4px',
                fontSize: '13px',
                fontFamily: "'EmOne', sans-serif"
              }}
            />
            {searchFilter && (
              <button
                onClick={() => setSearchFilter('')}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#8B0000',
                  cursor: 'pointer',
                  padding: '4px'
                }}
                title="Clear search"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* Confidence Filter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
            <span style={{ color: '#666', whiteSpace: 'nowrap' }}>Min confidence:</span>
            <input
              type="range"
              min="0"
              max="100"
              step="5"
              value={minConfidence}
              onChange={(e) => setMinConfidence(Number(e.target.value))}
              style={{ flex: 1 }}
            />
            <span style={{
              color: '#8B0000',
              fontWeight: 'bold',
              minWidth: '40px',
              textAlign: 'right'
            }}>
              {minConfidence}%
            </span>
          </div>
        </div>
      )}

      {/* Connection List */}
      <div className="connection-list" ref={connectionListRef}>
        {error && connectionScope === 'semantic' ? (
          <div className="connection-error">
            <span>Error loading semantic web connections: {error}</span>
            <button
              className="retry-button"
              onClick={() => {
                setSemanticConnections([]);
                setError(null);
                // Trigger reload by changing a dependency
                const event = new CustomEvent('retryConnections');
                window.dispatchEvent(event);
              }}
            >
              Retry
            </button>
          </div>
        ) : isLoading ? (
          <div className="connection-loading">
            <RefreshCw size={20} className="spin" />
            <span>
              {isDebouncing
                ? 'Waiting for input to stabilize...'
                : connectionScope === 'semantic'
                  ? 'Loading connections from semantic web...'
                  : 'Loading connections...'
              }
            </span>
          </div>
        ) : filteredConnections.length === 0 ? (
          <div className="no-connections">
            <CircleDot size={20} color="#666" />
            <span>
              No {connectionScope === 'graph' ? 'graph' :
                connectionScope === 'universe' ? 'universe' :
                  'semantic web'} connections found
            </span>
            {connectionScope !== 'semantic' && (
              <div style={{ fontSize: '0.75rem', color: '#999', marginTop: '4px' }}>
                {connectionScope === 'graph'
                  ? 'Connect nodes in this graph to see relationships here'
                  : 'Connect instances of this node across any graph'
                }
              </div>
            )}
          </div>
        ) : (
          filteredConnections.map((connection) => (
            <RDFTriplet
              key={connection.id}
              subject={connection.subject}
              predicate={connection.predicate}
              object={connection.object}
              subjectColor={getNodeColor(connection.subject)}
              objectColor={getNodeColor(connection.object)}
              onMaterialize={() => handleMaterializeConnection(connection)}
              connection={connection}
              isUltraSlim={isUltraSlim}
              containerWidth={containerWidth}
            />
          ))
        )}
      </div>
    </div>
  );
};

export default ConnectionBrowser;