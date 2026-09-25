import React, { useMemo, useRef, useState, useCallback, useEffect } from 'react';
import './TypeList.css';
import { HEADER_HEIGHT, NODE_DEFAULT_COLOR } from './constants';
import NodeType from './NodeType'; // Import NodeType
import EdgeType from './EdgeType'; // Import EdgeType
import useGraphStore from './store/graphStore.js';
import useCanvasUIStore from './store/canvasUIStore.js';
import { useStableSelector, shallowArrayEqual, arrayOfRecordsEqual } from './hooks/useStableSelector.js';
import { getTextColor, hexToHsl, hslToHex } from './utils/colorUtils.js';
// Placeholder icons (replace with actual icons later)
import { ChevronUp, Tag, Share2, LayoutGrid } from 'lucide-react';
import { useTheme } from './hooks/useTheme.js';

// When the list is hidden, the toggle button dims itself after this much
// inactivity so it stops competing with the canvas.
const TOGGLE_IDLE_DELAY_MS = 1000;
const TOGGLE_IDLE_OPACITY = 0.3;

// What the list shows, derived from the active web without its positions
// (P2.10). `graphs` is a new Map on every node move; these selectors, with their
// equality checks, keep a move from re-rendering the list.

// The footer's source colour: the active web's defining node (as Header does).
const selectFooterNodeColor = (state) => {
  const activeGraph = state.activeGraphId ? state.graphs.get(state.activeGraphId) : null;
  if (!activeGraph) return null;
  const definingNodeId = activeGraph.definingNodeIds?.[0];
  const definingNode = definingNodeId ? state.nodePrototypes.get(definingNodeId) : null;
  return definingNode?.color || activeGraph.color || NODE_DEFAULT_COLOR;
};

// The type nodes used on the active web; the base "Thing" when there are none.
const selectAvailableTypeNodes = (state) => {
  const usedTypeIds = new Set();
  const activeGraph = state.activeGraphId ? state.graphs.get(state.activeGraphId) : null;
  if (activeGraph?.instances) {
    for (const instance of activeGraph.instances.values()) {
      const prototype = state.nodePrototypes.get(instance.prototypeId);
      if (prototype?.typeNodeId) usedTypeIds.add(prototype.typeNodeId);
    }
  }
  const typeNodes = Array.from(usedTypeIds)
    .map(id => state.nodePrototypes.get(id))
    .filter(Boolean);
  if (typeNodes.length > 0) return typeNodes;
  const baseThing = state.nodePrototypes.get('base-thing-prototype');
  return baseThing ? [baseThing] : [];
};

// Every node instance on the active web, by name.
const selectAvailableComponents = (state) => {
  const activeGraph = state.activeGraphId ? state.graphs.get(state.activeGraphId) : null;
  if (!activeGraph?.instances) return [];
  return Array.from(activeGraph.instances.values())
    .map(instance => {
      const prototype = state.nodePrototypes.get(instance.prototypeId);
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
};
const sameComponents = arrayOfRecordsEqual(['instanceId', 'prototypeId', 'name', 'color']);

// The connection types used on the active web; the base "Connection" when there
// are none. Connection types are node prototypes (edge.definitionNodeIds) or,
// for edges created through the store, edge prototypes (edge.typeNodeId).
const selectAvailableConnectionTypes = (state) => {
  const usedConnectionTypeIds = new Set();
  const activeGraph = state.activeGraphId ? state.graphs.get(state.activeGraphId) : null;
  for (const edgeId of activeGraph?.edgeIds || []) {
    const edge = state.edges.get(edgeId);
    if (!edge) continue;
    if (edge.definitionNodeIds && edge.definitionNodeIds.length > 0) {
      edge.definitionNodeIds.forEach(nodeId => usedConnectionTypeIds.add(nodeId));
    } else if (edge.typeNodeId) {
      usedConnectionTypeIds.add(edge.typeNodeId);
    }
  }
  const connectionTypes = Array.from(usedConnectionTypeIds)
    .map(id => state.nodePrototypes.get(id) || state.edgePrototypes.get(id))
    .filter(Boolean);
  if (connectionTypes.length > 0) return connectionTypes;
  const baseConnectionPrototype = state.edgePrototypes.get('base-connection-prototype');
  return baseConnectionPrototype ? [baseConnectionPrototype] : [];
};

const TypeList = () => {
  const theme = useTheme();
  // Use shared state from store for TypeList mode
  const mode = useGraphStore((state) => state.typeListMode);
  const setTypeListMode = useGraphStore((state) => state.setTypeListMode);

  // Ref for scrollable content area
  const contentRef = useRef(null);

  // Idle fade for the toggle button (hide mode only)
  const [toggleIdle, setToggleIdle] = useState(false);
  const [toggleHovered, setToggleHovered] = useState(false);
  const [toggleInteractionTick, setToggleInteractionTick] = useState(0);
  const wakeToggle = useCallback(() => setToggleInteractionTick((t) => t + 1), []);

  useEffect(() => {
    // Only fade while hidden, and never while the pointer is on the button
    if (mode !== 'closed' || toggleHovered) {
      setToggleIdle(false);
      return undefined;
    }

    setToggleIdle(false);
    const timer = setTimeout(() => setToggleIdle(true), TOGGLE_IDLE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [mode, toggleHovered, toggleInteractionTick]);

  // Save state to localStorage whenever mode changes
  useEffect(() => {
    localStorage.setItem('redstring_typelist_mode', mode);
  }, [mode]);

  const footerNodeColor = useGraphStore(selectFooterNodeColor);
  const headerBg = useMemo(() => {
    if (!footerNodeColor) return '#260000';
    const { h, s } = hexToHsl(footerNodeColor);
    return hslToHex(h, Math.min(s, 100), 7.5);
  }, [footerNodeColor]);

  const footerHeaderText = useMemo(() => {
    return getTextColor(headerBg, theme.darkMode);
  }, [headerBg, theme.darkMode]);

  // Ensure base "Thing" prototype exists (side effect, must be in useEffect)
  const hasBaseThingPrototype = useGraphStore(state => state.nodePrototypes.has('base-thing-prototype'));
  useEffect(() => {
    if (!hasBaseThingPrototype) {
      useGraphStore.getState().addNodePrototype({
        id: 'base-thing-prototype',
        name: 'Thing',
        description: 'The base type for all things. Things are nodes, ideas, nouns, concepts, objects, whatever you want them to be. They will always be at the bottom of the abstraction stack. They are the "atoms" of your Redstring universe.',
        color: '#8B0000', // maroon
        typeNodeId: null, // No parent type - this is the base type
        definitionGraphIds: []
      });
    }
  }, [hasBaseThingPrototype]);

  const availableTypeNodes = useStableSelector(useGraphStore, selectAvailableTypeNodes, shallowArrayEqual);
  const availableComponents = useStableSelector(useGraphStore, selectAvailableComponents, sameComponents);
  const availableConnectionTypes = useStableSelector(useGraphStore, selectAvailableConnectionTypes, shallowArrayEqual);

  const handleNodeTypeClick = (nodeType) => {
    const { selectedInstanceIds, setSelectedInstanceIds } = useCanvasUIStore.getState();
    const store = useGraphStore.getState();
    // If there are selected nodes, set their type to the clicked node type
    if (selectedInstanceIds.size > 0) {
      selectedInstanceIds.forEach(nodeId => {
        // Don't allow a node to be typed by itself or change the base Thing prototype
        if (nodeId !== nodeType.id && nodeId !== 'base-thing-prototype') {
          store.setNodeType(nodeId, nodeType.id);
        }
      });
    } else {
      // If no nodes are selected, select all nodes of this type
      const instances = store.graphs.get(store.activeGraphId)?.instances;
      const nodeIds = instances
        ? Array.from(instances.values())
          .filter(instance => store.nodePrototypes.get(instance.prototypeId)?.typeNodeId === nodeType.id)
          .map(instance => instance.id)
        : [];
      setSelectedInstanceIds(new Set(nodeIds));
    }
  };

  const handleComponentClick = (component) => {
    // Select the instance node on the canvas. Don't open the right panel —
    // double-tapping the node on canvas is how you open it.
    useCanvasUIStore.getState().setSelectedInstanceIds(new Set([component.instanceId]));
  };

  const handleEdgeTypeClick = (edgeType) => {
    // Find all edges of this type in the current graph
    const edgesOfType = [];
    const { activeGraphId, graphs: graphsMap, edges: edgesMap } = useGraphStore.getState();

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
    // Slightly smaller than the panel icons so it sits inside the circular button
    const iconSize = HEADER_HEIGHT * 0.4;
    switch (mode) {
      case 'node':
        return <Tag size={iconSize} />;
      case 'connection': // Icon for connection mode
        return <Share2 size={iconSize} />;
      case 'component':
        return <LayoutGrid size={iconSize} />;
      case 'closed':
      default:
        return <ChevronUp size={iconSize} />; // Use ChevronUp for closed state
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
        onClick={() => { wakeToggle(); cycleMode(); }}
        onPointerDown={wakeToggle}
        onMouseEnter={() => setToggleHovered(true)}
        onMouseLeave={() => setToggleHovered(false)}
        onFocus={wakeToggle}
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
          border: '2px solid ' + (theme.canvas?.bg || '#BDB5B5'), // Canvas color stroke
          borderRadius: '50%',
          padding: 0,
          cursor: 'pointer',
          color: '#EFE8E5',
          zIndex: 20000, // Higher than panels (10000)
          boxShadow: '0 0 0 3px ' + (theme.canvas?.bg || '#BDB5B5') + ', 0 2px 5px rgba(0, 0, 0, 0.2)',
          opacity: toggleIdle ? TOGGLE_IDLE_OPACITY : 1,
          // Slow fade out when idle, quick fade back in on hover/interaction
          transition: `background-color 0.2s ease, color 0.2s ease, opacity ${toggleIdle ? '0.8s' : '0.15s'} ease`
        }}
      >
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
                  color: theme.canvas?.textMuted || 'rgba(189, 181, 181, 0.5)',
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


export default TypeList;
