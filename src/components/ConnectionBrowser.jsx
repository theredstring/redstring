import React, { useState, useEffect, useMemo, useRef } from 'react';
import { CircleDot, ChevronDown, BookOpen, Globe, TextSearch } from 'lucide-react';
import useGraphStore from '../store/graphStore.js';
import { useTheme } from '../hooks/useTheme.js';
import PanelIconButton from './shared/PanelIconButton.jsx';
import { showContextMenuForElement } from './GlobalContextMenu.jsx';
import TripletPreview from './connections/TripletPreview.jsx';
import SemanticConnectionList from './connections/SemanticConnectionList.jsx';
import useSemanticConnections from '../hooks/useSemanticConnections.js';
import CompactConnectionRow, { COMPACT_CONNECTIONS_BELOW } from './connections/CompactConnectionRow.jsx';
import './ConnectionBrowser.css';

// The scopes, each wearing the icon of the left-panel tab it matches: an open
// web, the universe, the semantic web.
const CONNECTION_SCOPES = [
  { value: 'graph', label: 'In Graph', Icon: BookOpen },
  { value: 'universe', label: 'Universe', Icon: Globe },
  { value: 'semantic', label: 'Semantic Web', Icon: TextSearch },
];

/**
 * One of this Thing's own connections, drawn with the shared triplet preview.
 * Arrowheads follow the edge's own directionality.
 */
const NativeTriplet = ({ connection, subjectColor, objectColor, containerWidth, compact = false, note }) => {
  const arrowsToward = new Set();
  const dir = connection?.directionality;
  if (typeof dir === 'string') {
    if (dir === 'directed') arrowsToward.add('object');
    else if (dir === 'bidirectional') { arrowsToward.add('subject'); arrowsToward.add('object'); }
  } else if (dir && typeof dir === 'object' && dir.arrowsToward instanceof Set) {
    if (dir.arrowsToward.has(connection.sourceInstanceId)) arrowsToward.add('subject');
    if (dir.arrowsToward.has(connection.destinationInstanceId)) arrowsToward.add('object');
  } else {
    arrowsToward.add('object');
  }

  if (compact) {
    // Which way it points, from this Thing's side.
    const thisEnd = connection.isSource ? 'subject' : 'object';
    const otherEnd = connection.isSource ? 'object' : 'subject';
    const leads = arrowsToward.has(otherEnd);
    const points = arrowsToward.has(thisEnd);
    return (
      <div className="connection-triplet" title={`${connection.subject} → ${connection.predicate} → ${connection.object}`}>
        <CompactConnectionRow
          predicate={connection.predicate}
          direction={leads && points ? 'both' : leads ? 'out' : points ? 'in' : 'none'}
          otherName={connection.connectedNodeName}
          otherColor={connection.isSource ? objectColor : subjectColor}
          note={note}
        />
      </div>
    );
  }

  return (
    <div className="connection-triplet" title={`${connection.subject} → ${connection.predicate} → ${connection.object}`}>
      <TripletPreview
        subject={connection.subject}
        predicate={connection.predicate}
        object={connection.object}
        subjectColor={subjectColor}
        objectColor={objectColor}
        connectionColor={connection.connectionColor || subjectColor}
        arrowsToward={arrowsToward}
        containerWidth={containerWidth}
      />
    </div>
  );
};

/**
 * Connection Browser Component
 * Shows connections with a scope chooser: In Graph | Universe | Semantic Web
 */
const ConnectionBrowser = ({ nodeData }) => {
  const theme = useTheme();
  // The scope the user picked for this Thing; until they pick, it's chosen for them.
  const [pickedScope, setPickedScope] = useState(null); // 'graph' | 'universe' | 'semantic'
  const [nativeConnections, setNativeConnections] = useState([]);
  // Which Thing nativeConnections were loaded for, so a stale list never picks the scope.
  const [nativeForId, setNativeForId] = useState(null);
  const [containerWidth, setContainerWidth] = useState(400); // Default width
  const connectionListRef = useRef(null);

  // Per field, not the whole store (F-78).
  const activeGraphId = useGraphStore(s => s.activeGraphId);
  const nodePrototypes = useGraphStore(s => s.nodePrototypes);
  const graphs = useGraphStore(s => s.graphs);
  const edges = useGraphStore(s => s.edges);

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
      setNativeForId(nodeData.id);
      console.log(`[ConnectionBrowser] Loaded ${connections.length} native connections for node ${nodeData.name}`);
    };

    loadNativeConnections();
  }, [nodeData?.id, connectionStructureHash, nodePrototypes, activeGraphId]);

  // A new Thing starts unpicked.
  useEffect(() => { setPickedScope(null); }, [nodeData?.id]);

  // Until the user picks: In Graph if it has any, else Universe, else the
  // semantic web if it has any, else back to In Graph. The semantic web is only
  // asked when this Thing has no connections of its own; its answer is cached,
  // so the list it switches to doesn't ask again.
  const nativeLoaded = nativeForId === nodeData?.id;
  const graphCount = nativeConnections.filter(conn => conn.inCurrentGraph).length;
  const hasNative = nativeConnections.length > 0;
  const semanticProbe = useSemanticConnections(
    !pickedScope && nativeLoaded && !hasNative ? nodeData : null
  );
  const autoScope = !nativeLoaded || graphCount > 0 ? 'graph'
    : hasNative ? 'universe'
      : semanticProbe.status === 'ready' && semanticProbe.connections.length > 0 ? 'semantic'
        : 'graph';
  const connectionScope = pickedScope || autoScope;
  const activeScope = CONNECTION_SCOPES.find(s => s.value === connectionScope) || CONNECTION_SCOPES[0];

  // Which of this Thing's own connections the scope shows.
  const filteredConnections = useMemo(() => (
    connectionScope === 'graph' ? nativeConnections.filter(conn => conn.inCurrentGraph)
      : connectionScope === 'universe' ? nativeConnections
        : []
  ), [connectionScope, nativeConnections]);

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

  if (!nodeData) {
    return (
      <div className="connection-browser-empty">
        No node data available for connections
      </div>
    );
  }

  return (
    <div className="connection-browser">
      {/* Scope chooser: the same outlined pill and maroon menu as the
          Universes and Semantic Discovery headers. */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
        <PanelIconButton
          icon={activeScope.Icon}
          size={16}
          label={
            <React.Fragment>
              {activeScope.label}{' '}
              <ChevronDown size={12} style={{ verticalAlign: 'middle', marginBottom: '1px' }} />
            </React.Fragment>
          }
          variant="outline"
          onClick={(e) => showContextMenuForElement(e.currentTarget, CONNECTION_SCOPES.map(opt => ({
            label: opt.label,
            icon: <opt.Icon size={14} />,
            active: connectionScope === opt.value,
            action: () => setPickedScope(opt.value),
          })))}
        />
        {connectionScope !== 'semantic' && (
          <span style={{ fontSize: '0.8rem', color: theme.canvas.textSecondary, fontFamily: "'EmOne', sans-serif", whiteSpace: 'nowrap' }}>
            {filteredConnections.length} connection{filteredConnections.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      <div className="connection-list" ref={connectionListRef}>
        {connectionScope === 'semantic' ? (
          <SemanticConnectionList
            seed={nodeData}
            seedPrototypeId={nodeData.id}
            seedColor={nodeData.color}
          />
        ) : filteredConnections.length === 0 ? (
          <div className="no-connections">
            <CircleDot size={20} />
            <span>No {connectionScope === 'graph' ? 'graph' : 'universe'} connections found</span>
            <div style={{ fontSize: '0.75rem', opacity: 0.75, marginTop: '4px' }}>
              {connectionScope === 'graph'
                ? 'Connect nodes in this graph to see relationships here'
                : 'Connect instances of this node across any graph'}
            </div>
          </div>
        ) : (
          filteredConnections.map((connection) => (
            <NativeTriplet
              key={connection.id}
              connection={connection}
              subjectColor={getNodeColor(connection.subject)}
              objectColor={getNodeColor(connection.object)}
              // minus the triplet's own 8px padding + 1px border per side
              containerWidth={Math.max(160, containerWidth - 18)}
              compact={containerWidth > 0 && containerWidth < COMPACT_CONNECTIONS_BELOW}
              note={connectionScope === 'universe' && !connection.inCurrentGraph ? `in ${connection.graphName || 'another web'}` : undefined}
            />
          ))
        )}
      </div>
    </div>
  );
};

export default ConnectionBrowser;
