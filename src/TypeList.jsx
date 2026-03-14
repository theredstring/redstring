import React, { useMemo, useRef, useCallback, useEffect } from 'react';
import PropTypes from 'prop-types';
import './TypeList.css';
import { HEADER_HEIGHT } from './constants';
import NodeType from './NodeType'; // Import NodeType
import EdgeType from './EdgeType'; // Import EdgeType
import useGraphStore from './store/graphStore.jsx';
import { getTextColor, hexToHsl, hslToHex } from './utils/colorUtils.js';
// Placeholder icons (replace with actual icons later)
import { ChevronUp, Tag, Share2, LayoutGrid } from 'lucide-react';

const TypeList = ({ nodes, setSelectedNodes, selectedNodes = new Set() }) => {
  // Use shared state from store for TypeList mode
  const mode = useGraphStore((state) => state.typeListMode);
  const setTypeListMode = useGraphStore((state) => state.setTypeListMode); 
  
  // Ref for scrollable content area
  const contentRef = useRef(null);

  // Save state to localStorage whenever mode changes
  useEffect(() => {
    localStorage.setItem('redstring_typelist_mode', mode);
  }, [mode]);

  // Get store data for finding type nodes and edges
  const activeGraphId = useGraphStore((state) => state.activeGraphId);
  const graphsMap = useGraphStore((state) => state.graphs);
  const nodePrototypesMap = useGraphStore((state) => state.nodePrototypes);
  const edgePrototypesMap = useGraphStore((state) => state.edgePrototypes);
  const edgesMap = useGraphStore((state) => state.edges);
  const setNodeTypeAction = useGraphStore((state) => state.setNodeType);

  // Derive footer colors from defining node's color (matching Header.jsx headerGraphs pattern)
  const headerBg = useMemo(() => {
    const fallbackBg = '#260000';
    if (!activeGraphId) return fallbackBg;

    const activeGraph = graphsMap.get(activeGraphId);
    if (!activeGraph) return fallbackBg;

    // Header.jsx derives color from the defining node prototype, not graph.color
    const definingNodeId = activeGraph.definingNodeIds?.[0];
    const definingNode = definingNodeId ? nodePrototypesMap.get(definingNodeId) : null;
    const nodeColor = definingNode?.color || activeGraph.color || NODE_DEFAULT_COLOR;

    const { h, s } = hexToHsl(nodeColor);
    return hslToHex(h, Math.min(s, 100), 7.5);
  }, [activeGraphId, graphsMap, nodePrototypesMap]);

  const footerHeaderText = useMemo(() => {
    return getTextColor(headerBg);
  }, [headerBg]);
  
  // Ensure base "Thing" prototype exists (side effect, must be in useEffect)
  useEffect(() => {
    const hasBaseThingPrototype = Array.from(nodePrototypesMap.values())
      .some(prototype => prototype.id === 'base-thing-prototype');
    
    if (!hasBaseThingPrototype) {
      // console.log(`[TypeList] Base "Thing" prototype missing, creating it...`);
      // Create the missing base "Thing" prototype
      const storeActions = useGraphStore.getState();
      storeActions.addNodePrototype({
        id: 'base-thing-prototype',
        name: 'Thing',
        description: 'The base type for all things. Things are nodes, ideas, nouns, concepts, objects, whatever you want them to be. They will always be at the bottom of the abstraction stack. They are the "atoms" of your Redstring universe.',
        color: '#8B0000', // maroon
        typeNodeId: null, // No parent type - this is the base type
        definitionGraphIds: []
      });
    }
  }, [nodePrototypesMap]);

  // Get the type nodes available for the current active graph
  const availableTypeNodes = useMemo(() => {
    
    const usedTypeIds = new Set();
    
    // If there's an active graph with instances, collect types being used
    if (activeGraphId) {
      const activeGraph = graphsMap.get(activeGraphId);
      if (activeGraph && activeGraph.instances) {
        const instances = Array.from(activeGraph.instances.values());
        // For each instance, get its prototype and collect the types being used
        instances.forEach(instance => {
          const prototype = nodePrototypesMap.get(instance.prototypeId);
          if (prototype && prototype.typeNodeId) {
            usedTypeIds.add(prototype.typeNodeId);
          }
        });
      }
    }
    
    // Get the actual prototype objects for the used types
    let typeNodes = Array.from(usedTypeIds)
      .map(id => nodePrototypesMap.get(id))
      .filter(Boolean);
      
    // If no specific types are used (or no active graph), include base types
    if (typeNodes.length === 0) {
      const baseThing = nodePrototypesMap.get('base-thing-prototype');
      typeNodes = baseThing ? [baseThing] : [];
    }
    
    return typeNodes;
  }, [activeGraphId, graphsMap, nodePrototypesMap]);

  // Get all component nodes (instances) for the current active graph
  const availableComponents = useMemo(() => {
    if (!activeGraphId) return [];

    const activeGraph = graphsMap.get(activeGraphId);
    if (!activeGraph || !activeGraph.instances) return [];

    return Array.from(activeGraph.instances.values())
      .map(instance => {
        const prototype = nodePrototypesMap.get(instance.prototypeId);
        if (!prototype) return null;
        return {
          instanceId: instance.id,
          prototypeId: instance.prototypeId,
          name: prototype.name,
          color: prototype.color,
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [activeGraphId, graphsMap, nodePrototypesMap]);

  // Get the connection types available for the current active graph
  const availableConnectionTypes = useMemo(() => {
    const usedConnectionTypeIds = new Set();
    
    // If there's an active graph with edges, collect connection types being used
    if (activeGraphId) {
      const activeGraph = graphsMap.get(activeGraphId);
      if (activeGraph && activeGraph.edgeIds) {
        activeGraph.edgeIds.forEach(edgeId => {
          const edge = edgesMap.get(edgeId);
          if (edge) {
            // Check definitionNodeIds first, then fallback to typeNodeId
            if (edge.definitionNodeIds && edge.definitionNodeIds.length > 0) {
              // Connection types are stored as node prototypes referenced by definitionNodeIds
              edge.definitionNodeIds.forEach(nodeId => {
                usedConnectionTypeIds.add(nodeId);
              });
            } else if (edge.typeNodeId) {
              // Fallback to typeNodeId (for edges created through the store)
              usedConnectionTypeIds.add(edge.typeNodeId);
            }
          }
        });
      }
    }
    
    // Get the actual connection type prototypes
    let connectionTypes = Array.from(usedConnectionTypeIds)
      .map(id => {
        // Try both nodePrototypesMap (for definitionNodeIds) and edgePrototypesMap (for typeNodeId)
        return nodePrototypesMap.get(id) || edgePrototypesMap.get(id);
      })
      .filter(Boolean);
      
    // If no specific connection types are used, show the base Connection type
    if (connectionTypes.length === 0) {
      // Check if base "Connection" prototype exists
      const baseConnectionPrototype = edgePrototypesMap.get('base-connection-prototype');
      if (baseConnectionPrototype) {
        connectionTypes = [baseConnectionPrototype];
      }
    }
    
    return connectionTypes;
  }, [activeGraphId, graphsMap, nodePrototypesMap, edgesMap]);

  const handleNodeTypeClick = (nodeType) => {
    // If there are selected nodes, set their type to the clicked node type
    if (selectedNodes.size > 0) {
      selectedNodes.forEach(nodeId => {
        // Don't allow a node to be typed by itself or change the base Thing prototype
        if (nodeId !== nodeType.id && nodeId !== 'base-thing-prototype') {
          setNodeTypeAction(nodeId, nodeType.id);
        }
      });
      // console.log(`Set type of ${selectedNodes.size} nodes to ${nodeType.name}`);
    } else {
      // If no nodes are selected, select all nodes of this type
      const nodesOfType = nodes.filter(node => {
        // Find the prototype for this node instance
        const prototype = nodePrototypesMap.get(node.prototypeId);
        return prototype?.typeNodeId === nodeType.id;
      });
      const nodeIds = nodesOfType.map(node => node.id);
      setSelectedNodes(new Set(nodeIds));
      // console.log(`Selected ${nodeIds.length} nodes of type ${nodeType.name}`);
    }
  };

  const handleComponentClick = (component) => {
    // Select the instance node on the canvas
    setSelectedNodes(new Set([component.instanceId]));

    // Open it in the right panel
    const openRightPanelNodeTab = useGraphStore.getState().openRightPanelNodeTab;
    openRightPanelNodeTab(component.prototypeId);
  };

  const handleEdgeTypeClick = (edgeType) => {
    // Find all edges of this type in the current graph
    const edgesOfType = [];
    
    if (activeGraphId) {
      const activeGraph = graphsMap.get(activeGraphId);
      if (activeGraph && activeGraph.edgeIds) {
        activeGraph.edgeIds.forEach(edgeId => {
          const edge = edgesMap.get(edgeId);
          if (edge) {
            // Check if this edge matches the selected type
            let matchesType = false;
            
            if (edge.definitionNodeIds && edge.definitionNodeIds.length > 0) {
              // Check if any definitionNodeId matches the selected type
              matchesType = edge.definitionNodeIds.includes(edgeType.id);
            } else if (edge.typeNodeId) {
              // Check if typeNodeId matches the selected type
              matchesType = edge.typeNodeId === edgeType.id;
            }
            
            if (matchesType) {
              edgesOfType.push(edgeId);
            }
          }
        });
      }
    }
    
    // Select all edges of this type
    if (edgesOfType.length > 0) {
      const setSelectedEdgeIds = useGraphStore.getState().setSelectedEdgeIds;
      setSelectedEdgeIds(edgesOfType);
      // console.log(`Selected ${edgesOfType.length} edges of type ${edgeType.name}`);
    }
    
    // Open the panel tab for the connection type's defining node
    const openRightPanelNodeTab = useGraphStore.getState().openRightPanelNodeTab;
    openRightPanelNodeTab(edgeType.id);
  };

  const cycleMode = () => {
    // Cycle order: connection -> node -> component -> closed -> connection
    const newMode = mode === 'connection' ? 'node' :
                   mode === 'node' ? 'component' :
                   mode === 'component' ? 'closed' : 'connection';
    setTypeListMode(newMode);
  };

  const getButtonIcon = () => {
    switch (mode) {
      case 'node':
        return <Tag size={HEADER_HEIGHT * 0.6} />;
      case 'connection': // Icon for connection mode
        return <Share2 size={HEADER_HEIGHT * 0.6} />;
      case 'component':
        return <LayoutGrid size={HEADER_HEIGHT * 0.6} />;
      case 'closed':
      default:
        return <ChevronUp size={HEADER_HEIGHT * 0.6} />; // Use ChevronUp for closed state
    }
  };

  // Content area scroll handler (similar to Panel.jsx tab scrolling)
  const handleContentWheel = useCallback((e) => {
    if (contentRef.current) {
      e.preventDefault();
      e.stopPropagation();

      const element = contentRef.current;
      
      let scrollAmount = 0;
      // Prioritize axis with larger absolute delta
      if (Math.abs(e.deltaY) >= Math.abs(e.deltaX)) {
        scrollAmount = e.deltaY;
      } else {
        scrollAmount = e.deltaX;
      }

      const sensitivity = 0.5; 
      const scrollChange = scrollAmount * sensitivity;

      // Only try to scroll if there's actually scrollable content
      if (element.scrollWidth > element.clientWidth) {
        element.scrollLeft += scrollChange;
      }
    }
  }, []);

  // Effect to manually add non-passive wheel listener
  useEffect(() => {
    const contentNode = contentRef.current;
    
    if (contentNode && mode !== 'closed') {
      // Add listener with passive: false to allow preventDefault
      contentNode.addEventListener('wheel', handleContentWheel, { passive: false });

      // Cleanup function
      return () => {
        contentNode.removeEventListener('wheel', handleContentWheel, { passive: false });
      };
    }
  }, [mode, handleContentWheel]);

  return (
    <>
      {/* Mode Toggle Button - Positioned Separately and Fixed */}
      <button
        onClick={cycleMode}
        className="type-list-toggle-button"
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          margin: '0 0 10px 10px',
          height: `${HEADER_HEIGHT}px`,
          width: `${HEADER_HEIGHT}px`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: headerBg,
          border: '2px solid #BDB5B5', // Canvas color stroke
          borderRadius: '8px',
          padding: 0,
          cursor: 'pointer',
          color: footerHeaderText,
          zIndex: 20000, // Higher than panels (10000)
          boxShadow: '0 0 0 3px #BDB5B5, 0 2px 5px rgba(0, 0, 0, 0.2)',
          transition: 'background-color 0.2s ease, color 0.2s ease'
        }}
      >
        {/* Icon size is HEADER_HEIGHT * 0.6 = 30 (matches panel icon size) */}
        {getButtonIcon()}
      </button>

      {/* Sliding Footer Bar */}
      <footer
        className="type-list-bar"
        style={{
          height: `${HEADER_HEIGHT}px`,
          position: 'fixed',
          bottom: 0,
          left: 0, // Cover full width
          right: 0,
          display: 'flex',
          alignItems: 'center',
          backgroundColor: headerBg,
          zIndex: 19999, // Higher than panels but lower than toggle button
          overflow: 'visible', // Allow content to overflow horizontally for scrolling
          transition: 'background-color 0.2s ease-in-out, transform 0.3s ease-in-out',
          transform: mode === 'closed' ? 'translateY(100%)' : 'translateY(0)',
          paddingLeft: `calc(${HEADER_HEIGHT}px + 20px)`, // Increase paddingLeft for more space between button and content
          boxShadow: '0 -4px 8px rgba(0, 0, 0, 0.2)'
        }}
      >
        {/* Scrollable Content Area */}
        <div 
          ref={contentRef}
          className="type-list-content"
          style={{
            flex: '1 1 auto', // Allow growing and shrinking as needed
            minWidth: 0, // Allow shrinking if needed
            display: 'flex', 
            alignItems: 'center',
            overflowX: 'auto',
            overflowY: 'hidden',
            scrollbarWidth: 'none', // Firefox
            msOverflowStyle: 'none', // Internet Explorer 10+
            WebkitScrollbar: 'none', // WebKit
            paddingRight: '20px', // Add right padding to ensure last items are accessible
          }}
        >
          {mode === 'node' && (
            <>
              {/* Header for Types */}
              <div style={{
                fontSize: '18px',
                fontWeight: 'bold',
                fontFamily: "'EmOne', sans-serif",
                color: footerHeaderText,
                marginLeft: '10px', // Add left margin for balance
                marginRight: '20px',
                paddingTop: '8px',
                paddingBottom: '8px',
                whiteSpace: 'nowrap',
                flexShrink: 0 // Prevent shrinking
              }}>
                Types
              </div>
              
              {/* Show available type nodes for the current graph */}
              {availableTypeNodes.map(prototype => (
                <div key={prototype.id} style={{ flexShrink: 0 }}> {/* Prevent shrinking */}
                  <NodeType 
                    name={prototype.name} 
                    color={prototype.color} 
                    onClick={() => handleNodeTypeClick(prototype)} 
                  />
                </div>
              ))}
            </>
          )}
          {mode === 'component' && (
            <>
              {/* Header for Components */}
              <div style={{
                fontSize: '18px',
                fontWeight: 'bold',
                fontFamily: "'EmOne', sans-serif",
                color: footerHeaderText,
                marginLeft: '10px',
                marginRight: '20px',
                paddingTop: '8px',
                paddingBottom: '8px',
                whiteSpace: 'nowrap',
                flexShrink: 0
              }}>
                Components
              </div>

              {/* Show all node instances in the current graph */}
              {availableComponents.map(component => (
                <div key={component.instanceId} style={{ flexShrink: 0 }}>
                  <NodeType
                    name={component.name}
                    color={component.color}
                    onClick={() => handleComponentClick(component)}
                  />
                </div>
              ))}
              {availableComponents.length === 0 && (
                <div style={{
                  fontSize: '14px',
                  fontFamily: "'EmOne', sans-serif",
                  color: 'rgba(189, 181, 181, 0.5)',
                  whiteSpace: 'nowrap',
                  fontStyle: 'italic'
                }}>
                  No components in this Web
                </div>
              )}
            </>
          )}
          {mode === 'connection' && (
            <>
              {/* Header for Connections */}
              <div style={{
                fontSize: '18px',
                fontWeight: 'bold',
                fontFamily: "'EmOne', sans-serif",
                color: footerHeaderText,
                marginLeft: '10px', // Add left margin for balance
                marginRight: '20px',
                paddingTop: '8px',
                paddingBottom: '8px',
                whiteSpace: 'nowrap',
                flexShrink: 0 // Prevent shrinking
              }}>
                Connections
              </div>
              
              {/* Show available connection types for the current graph */}
              {availableConnectionTypes.map(prototype => (
                <div key={prototype.id} style={{ flexShrink: 0 }}> {/* Prevent shrinking */}
                  <EdgeType 
                    name={prototype.name} 
                    color={prototype.color} 
                    onClick={() => handleEdgeTypeClick(prototype)} 
                  />
                </div>
              ))}
            </>
          )}
        </div>
      </footer>
    </>
  );
};

TypeList.propTypes = {
  nodes: PropTypes.array.isRequired,
  setSelectedNodes: PropTypes.func.isRequired,
  selectedNodes: PropTypes.instanceOf(Set)
};

export default TypeList;
