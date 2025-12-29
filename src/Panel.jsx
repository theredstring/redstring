import React, { useState, useEffect, forwardRef, useImperativeHandle, useRef, useCallback, useMemo, Suspense, lazy, memo } from 'react';
import { useDrag, useDrop, useDragLayer } from 'react-dnd';
import { getEmptyImage } from 'react-dnd-html5-backend'; // Import for hiding default preview
import { HEADER_HEIGHT, NODE_CORNER_RADIUS, THUMBNAIL_MAX_DIMENSION, NODE_DEFAULT_COLOR, PANEL_CLOSE_ICON_SIZE } from './constants';
import { ArrowLeftFromLine, ArrowRightFromLine, Info, ImagePlus, XCircle, BookOpen, LayoutGrid, Plus, Bookmark, ArrowUpFromDot, Palette, ArrowBigRightDash, X, Globe, Settings, RotateCcw, Send, Bot, User, Key, Square, Search, Merge, Copy, Loader2, TextSearch, Sparkles } from 'lucide-react';
import ToggleSlider from './components/ToggleSlider.jsx';
import { v4 as uuidv4 } from 'uuid';
import './Panel.css'
import { generateThumbnail } from './utils'; // Import thumbnail generator
import ToggleButton from './ToggleButton'; // Import the new component
import PanelResizerHandle from './components/PanelResizerHandle.jsx';
import ColorPicker from './ColorPicker'; // Import the new ColorPicker component
import PanelColorPickerPortal from './components/PanelColorPickerPortal.jsx';
import NodeSelectionGrid from './NodeSelectionGrid'; // Import NodeSelectionGrid for type selection
import UnifiedSelector from './UnifiedSelector'; // Import the new UnifiedSelector
import useGraphStore, {
  getActiveGraphId,
  getHydratedNodesForGraph,
  getActiveGraphData,
  getEdgesForGraph,
  getNodePrototypeById,
} from './store/graphStore.jsx';
import { shallow } from 'zustand/shallow';
import GraphListItem from './GraphListItem'; // <<< Import the new component
// Direct import (lazy loading removed to avoid production chunk 404 errors)
import GitNativeFederation from './GitNativeFederation.jsx';
// Inline AI Collaboration Panel as internal component below
import './ai/AICollaborationPanel.css';
import APIKeySetup from './ai/components/APIKeySetup.jsx';
import mcpClient from './services/mcpClient.js';
import * as fileStorage from './store/fileStorage.js';
// import { bridgeFetch } from './services/bridgeConfig.js';
import apiKeyManager from './services/apiKeyManager.js';
import SemanticEditor from './components/SemanticEditor.jsx';
import { enhancedSemanticSearch } from './services/semanticWebQuery.js';
import PanelContentWrapper from './components/panel/PanelContentWrapper.jsx';
import CollapsibleSection from './components/CollapsibleSection.jsx';
import StandardDivider from './components/StandardDivider.jsx';
import { knowledgeFederation } from './services/knowledgeFederation.js';
import DuplicateManager from './components/DuplicateManager.jsx';
import { showContextMenu } from './components/GlobalContextMenu.jsx';
import { normalizeToCandidate, candidateToConcept } from './services/candidates.js';
import DraggableTab from './components/panel/DraggableTab.jsx';
import SavedNodeItem from './components/panel/items/SavedNodeItem.jsx';
import AllThingsNodeItem from './components/panel/items/AllThingsNodeItem.jsx';
import DraggableConceptCard from './components/panel/items/DraggableConceptCard.jsx';
import GhostSemanticNode from './components/panel/items/GhostSemanticNode.jsx';
import CustomDragLayer from './components/panel/CustomDragLayer.jsx';
import LeftLibraryView from './components/panel/views/LeftLibraryView.jsx';
import LeftAllThingsView from './components/panel/views/LeftAllThingsView.jsx';
import LeftSemanticDiscoveryView from './components/panel/views/LeftSemanticDiscoveryView.jsx';
import LeftGridView from './components/panel/views/LeftGridView.jsx';
import LeftAIView from './components/panel/views/LeftAIView.jsx';

// Generate color for concept based on name hash - unified color system
// Uses the same saturation and brightness as maroon (#8B0000) but with different hues
// This matches the ColorPicker's approach for consistent, muted colors
const generateConceptColor = (name) => {
  // Hue values that create pleasant, readable colors with maroon's saturation/brightness
  const hues = [0, 25, 90, 140, 200, 260, 300]; // Red, Orange-Red, Green, Cyan-Green, Blue, Purple, Magenta

  // Convert HSV to hex (same logic as ColorPicker)
  const hsvToHex = (h, s, v) => {
    const c = v * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = v - c;

    let r, g, b;
    if (h >= 0 && h < 60) { r = c; g = x; b = 0; }
    else if (h >= 60 && h < 120) { r = x; g = c; b = 0; }
    else if (h >= 120 && h < 180) { r = 0; g = c; b = x; }
    else if (h >= 180 && h < 240) { r = 0; g = x; b = c; }
    else if (h >= 240 && h < 300) { r = x; g = 0; b = c; }
    else { r = c; g = 0; b = x; }

    r = Math.round((r + m) * 255);
    g = Math.round((g + m) * 255);
    b = Math.round((b + m) * 255);

    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  };

  // Use maroon's saturation (1.0) and brightness (~0.545) for consistency
  const targetSaturation = 1.0;
  const targetBrightness = 0.545;

  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash + name.charCodeAt(i)) & 0xffffffff;
  }

  const selectedHue = hues[Math.abs(hash) % hues.length];
  return hsvToHex(selectedHue, targetSaturation, targetBrightness);
};

// Ensure semantic node uses consistent color across all views
const getSemanticNodeColor = (nodeData) => {
  // If node has stored generated color from semantic metadata, use it
  if (nodeData.semanticMetadata?.generatedColor) {
    return nodeData.semanticMetadata.generatedColor;
  }
  // Otherwise use the node's current color or generate one
  return nodeData.color || generateConceptColor(nodeData.name || 'Unknown');
};

// Helper function to determine the correct article ("a" or "an")
const getArticleFor = (word) => {
  if (!word) return 'a';
  const firstLetter = word.trim()[0].toLowerCase();
  return ['a', 'e', 'i', 'o', 'u'].includes(firstLetter) ? 'an' : 'a';
};

// Define Item Type for react-dnd
const ItemTypes = {
  TAB: 'tab',
  SPAWNABLE_NODE: 'spawnable_node'
};

// CustomDragLayer component extracted to components/panel/CustomDragLayer.jsx

// SavedNodeItem extracted to components/panel/items/SavedNodeItem.jsx

// LeftLibraryView component extracted to components/panel/views/LeftLibraryView.jsx

// LeftAllThingsView component extracted to components/panel/views/LeftAllThingsView.jsx

// LeftSemanticDiscoveryView component extracted to components/panel/views/LeftSemanticDiscoveryView.jsx

// Draggable Concept Card - Core component of the new system
// DraggableConceptCard component extracted to components/panel/items/DraggableConceptCard.jsx

// GhostSemanticNode component extracted to components/panel/items/GhostSemanticNode.jsx

// All Things Node Item Component with semantic web glow and exact SavedNodeItem formatting
// AllThingsNodeItem component extracted to components/panel/items/AllThingsNodeItem.jsx

// Bridge Status Display Component - Disabled
// const BridgeStatusDisplay = () => {
//   const [statusMessages, setStatusMessages] = React.useState([]);
//   const [isVisible, setIsVisible] = React.useState(false);

//   React.useEffect(() => {
//     // Override console methods to catch errors
//     const originalConsoleError = console.error;
//     const originalConsoleLog = console.log;

//     console.error = (...args) => {
//       // Call original console.error
//       originalConsoleError.apply(console, args);

//       // Check if this is a bridge-related error
//       const message = args.join(' ');
//       if (message.includes('MCP Bridge') || 
//           message.includes('ERR_CONNECTION_REFUSED') ||
//           message.includes('Failed to fetch') ||
//           message.includes('bridge_unavailable_cooldown')) {

//         // Extract meaningful status from error messages
//         let statusText = '';
//         let statusType = 'info';

//         if (message.includes('ERR_CONNECTION_REFUSED')) {
//           statusText = 'Bridge server not available';
//           statusType = 'info';
//         } else if (message.includes('Failed to fetch')) {
//           statusText = 'Unable to connect to bridge server';
//           statusType = 'info';
//         } else if (message.includes('bridge_unavailable_cooldown')) {
//           const cooldownMatch = message.match(/(\d+)s remaining/);
//           const cooldownSeconds = cooldownMatch ? cooldownMatch[1] : 'unknown';
//           statusText = `Bridge temporarily unavailable (${cooldownSeconds}s)`;
//           statusType = 'info';
//         } else if (message.includes('Max reconnection attempts reached')) {
//           statusText = 'Bridge connection failed';
//           statusType = 'warning';
//         } else if (message.includes('Connection lost')) {
//           statusText = 'Bridge connection lost - reconnecting...';
//           statusType = 'info';
//         } else if (message.includes('Connection fully restored')) {
//           statusText = 'Bridge connection restored';
//           statusType = 'success';
//         } else if (message.includes('Redstring store bridge established')) {
//           statusText = 'Bridge connection established';
//           statusType = 'success';
//         } else {
//           statusText = 'Bridge connection issue detected';
//           statusType = 'info';
//         }

//         // Add to status messages
//         const newStatus = {
//           id: Date.now(),
//           text: statusText,
//           type: statusType,
//           timestamp: new Date(),
//           originalMessage: message
//         };

//         setStatusMessages(prev => {
//           const filtered = prev.filter(msg => 
//             msg.text !== statusText || 
//             Date.now() - msg.timestamp.getTime() > 10000
//           );
//           return [...filtered, newStatus];
//         });

//         setIsVisible(true);
//       }
//     };

//     console.log = (...args) => {
//       // Call original console.log
//       originalConsoleLog.apply(console, args);

//       // Check if this is a bridge-related success message
//       const message = args.join(' ');
//       if (message.includes('MCP Bridge') && 
//           (message.includes('✅') || message.includes('🎉'))) {

//         let statusText = '';
//         if (message.includes('Connection fully restored')) {
//           statusText = 'Bridge connection restored';
//           statusType = 'success';
//         } else if (message.includes('Redstring store bridge established')) {
//           statusText = 'Bridge connection established';
//           statusType = 'success';
//         } else if (message.includes('Store actions registered')) {
//           statusText = 'Bridge store actions registered';
//           statusType = 'success';
//         }

//         if (statusText) {
//           const newStatus = {
//             id: Date.now(),
//             text: statusText,
//             type: 'success',
//             timestamp: new Date(),
//             originalMessage: message
//           };

//           setStatusMessages(prev => {
//             const filtered = prev.filter(msg => 
//               msg.text !== statusText || 
//               Date.now() - msg.timestamp.getTime() > 10000
//             );
//             return [...filtered, newStatus];
//           });

//           setIsVisible(true);
//         }
//       }
//     };

//     // Cleanup function
//     return () => {
//       console.error = originalConsoleError;
//       console.log = originalConsoleLog;
//     };
//   }, []);

//   // Auto-hide status messages after 8 seconds
//   React.useEffect(() => {
//     if (statusMessages.length > 0) {
//       const timer = setTimeout(() => {
//         setStatusMessages(prev => prev.filter(msg => 
//           Date.now() - msg.timestamp.getTime() < 8000
//         ));

//         if (statusMessages.length === 0) {
//           setIsVisible(false);
//         }
//       }, 8000);

//       return () => clearTimeout(timer);
//     }
//   }, [statusMessages]);

//   // Auto-hide display if no messages
//   React.useEffect(() => {
//     if (statusMessages.length === 0) {
//       setIsVisible(false);
//         }
//   }, [statusMessages]);

//   if (!isVisible || statusMessages.length === 0) {
//     return null;
//   }

//   return (
//     <div style={{
//       marginBottom: '16px',
//       padding: '8px 12px',
//       backgroundColor: 'rgba(38, 0, 0, 0.05)',
//       border: '1px solid rgba(38, 0, 0, 0.1)',
//       borderRadius: '6px',
//       fontFamily: "'EmOne', sans-serif",
//       fontSize: '0.85rem'
//     }}>
//       {statusMessages.map(status => (
//         <div key={status.id} style={{
//           display: 'flex',
//           justifyContent: 'space-between',
//           marginBottom: statusMessages.indexOf(status) === statusMessages.length - 1 ? '0' : '6px',
//           color: status.type === 'success' ? '#10b981' : 
//                  status.type === 'warning' ? '#f59e0b' : 
//                  status.type === 'error' ? '#ef4444' : '#260000'
//         }}>
//           <span>{status.text}</span>
//           <button 
//             style={{
//               background: 'none',
//               border: 'none',
//               color: 'rgba(38, 0, 0, 0.5)',
//               fontSize: '16px',
//               cursor: 'pointer',
//               padding: '0',
//               width: '16px',
//               height: '16px',
//               display: 'flex',
//               alignItems: 'center',
//               justifyContent: 'center',
//               borderRadius: '50%',
//               transition: 'all 0.2s ease'
//             }}
//             onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(38, 0, 0, 0.1)'}
//             onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
//             onClick={() => {
//               setStatusMessages(prev => prev.filter(msg => msg.id !== status.id));
//             }}
//           >
//             ×
//           </button>
//         </div>
//       ))}
//     </div>
//   );
// };

// LeftGridView component extracted to components/panel/views/LeftGridView.jsx

// LeftAIView component extracted to components/panel/views/LeftAIView.jsx

// Draggable Tab Component
// DraggableTab extracted to components/panel/DraggableTab.jsx

/**
 * Panel
 * 
 * - Home tab at index 0 (locked).
 * - Node tabs afterwards.
 * - Double-click logic is handled in NodeCanvas, which calls openNodeTab(nodeId, nodeName).
 * - "onSaveNodeData" merges bio/image (and now name) into the NodeCanvas state.
 * - Image is scaled horizontally with "objectFit: contain."
 * - The circle around X has a fade‑in transition on hover.
 */
const MIN_PANEL_WIDTH = 100;
const INITIAL_PANEL_WIDTH = 280; // Match NodeCanvas default

// Feature flag: toggle visibility of the "All Things" tab in the left panel header
const ENABLE_ALL_THINGS_TAB = true;

// Helper to read width from storage
const getInitialWidth = (side, defaultValue) => {
  try {
    const storedWidth = localStorage.getItem(`panelWidth_${side}`);
    if (storedWidth !== null) {
      const parsedWidth = JSON.parse(storedWidth);
      if (typeof parsedWidth === 'number' && parsedWidth >= MIN_PANEL_WIDTH && parsedWidth <= window.innerWidth) {
        return parsedWidth;
      }
    }
  } catch (error) {
    console.error(`Error reading panelWidth_${side} from localStorage:`, error);
  }
  return defaultValue;
};

// Helper to read the last *non-default* width
const getInitialLastCustomWidth = (side, defaultValue) => {
  // Attempt to read specific key first
  try {
    const stored = localStorage.getItem(`lastCustomPanelWidth_${side}`);
    if (stored !== null) {
      const parsed = JSON.parse(stored);
      // Ensure it's valid and not the default width itself
      if (typeof parsed === 'number' && parsed >= MIN_PANEL_WIDTH && parsed <= window.innerWidth && parsed !== INITIAL_PANEL_WIDTH) {
        return parsed;
      }
    }
  } catch (error) {
    console.error(`Error reading lastCustomPanelWidth_${side} from localStorage:`, error);
  }
  // Fallback: Read the current width, use if it's not the default
  const currentWidth = getInitialWidth(side, defaultValue);
  return currentWidth !== INITIAL_PANEL_WIDTH ? currentWidth : defaultValue;
};

let panelRenderCount = 0; // Add counter outside component


// PERFORMANCE FIX: Wrap Panel in memo to prevent re-renders during zoom
// The Panel is a child of NodeCanvas, which re-renders on every zoom level change.
// Without memo, both left and right Panels would re-render on every wheel event.
// Custom comparison to avoid re-renders on hydratedNodes array reference changes
// when the actual node data hasn't changed (e.g., only viewport state changed)
const panelPropsAreEqual = (prevProps, nextProps) => {
  // Compare all props except those that might have unstable references
  const keysToCompare = [
    'isExpanded', 'side', 'activeGraphId', 'graphName', 'graphDescription',
    'leftPanelExpanded', 'rightPanelExpanded', 'initialViewActive'
  ];
  
  for (const key of keysToCompare) {
    if (prevProps[key] !== nextProps[key]) return false;
  }
  
  // For hydratedNodes, compare length and IDs instead of reference
  const prevNodes = prevProps.hydratedNodes || [];
  const nextNodes = nextProps.hydratedNodes || [];
  if (prevNodes.length !== nextNodes.length) return false;
  for (let i = 0; i < prevNodes.length; i++) {
    if (prevNodes[i]?.id !== nextNodes[i]?.id) return false;
  }
  
  // For selectedInstanceIds, compare Set contents
  const prevSelected = prevProps.selectedInstanceIds;
  const nextSelected = nextProps.selectedInstanceIds;
  if (prevSelected?.size !== nextSelected?.size) return false;
  if (prevSelected && nextSelected) {
    for (const id of prevSelected) {
      if (!nextSelected.has(id)) return false;
    }
  }
  
  // Callbacks are stable due to useCallback, so reference equality should work
  // storeActions, onToggleExpand, onFocusChange, onStartHurtleAnimationFromPanel
  // should be stable references
  
  return true;
};

const Panel = memo(forwardRef(
  ({
    isExpanded,
    onToggleExpand,
    onFocusChange,
    side = 'right',
    // Add props for store data/actions
    activeGraphId,
    storeActions,
    renderTrigger,
    graphName,
    graphDescription,
    activeDefinitionNodeId: propActiveDefinitionNodeId,
    nodeDefinitionIndices = new Map(), // Context-specific definition indices 
    onStartHurtleAnimationFromPanel, // <<< Add new prop for animation
    leftPanelExpanded = true,
    selectedInstanceIds = new Set(), // Add selected node instances from canvas
    hydratedNodes = [], // Add hydrated nodes from canvas
    rightPanelExpanded = true,
    initialViewActive,
  }, ref) => {
    const [isScrolling, setIsScrolling] = useState(false);
    const [isHoveringScrollbar, setIsHoveringScrollbar] = useState(false);
    const scrollTimeoutRef = useRef(null);
    const scrollbarHoverTimeoutRef = useRef(null);
    panelRenderCount++; // Increment counter
    // --- Zustand State and Actions ---
    /* // Store subscription remains commented out
    const selector = useCallback(
        (state) => {
            // Select only ID and actions reactively
            const currentActiveGraphId = getActiveGraphId(state);
            return {
                activeGraphId: currentActiveGraphId,
                createNewGraph: state.createNewGraph,
                setActiveGraph: state.createNewGraph,
                openRightPanelNodeTab: state.openRightPanelNodeTab,
                closeRightPanelTab: state.closeRightPanelTab,
                activateRightPanelTab: state.activateRightPanelTab,
                moveRightPanelTab: state.moveRightPanelTab,
                updateNode: state.updateNode,
                updateGraph: state.updateGraph,
            };
        },
        [side] // Side prop is stable, but keep it just in case?
    );

    const store = useGraphStore(selector, shallow);
    */

    // 🔧 PROPER PATTERN FOR ADDING NEW STORE DATA:
    // If you need to add new store properties, add them to the individual subscriptions above
    // and make sure to add a comment explaining why they're needed.
    // 
    // Example:
    // const newProperty = useGraphStore(state => state.newProperty); // For new feature X
    //
    // DO NOT create new consolidated subscriptions - this component is optimized for performance

    // Destructure selected state and actions (Use props now)
    const createNewGraph = storeActions?.createNewGraph;
    const setActiveGraph = storeActions?.setActiveGraph;
    const openRightPanelNodeTab = storeActions?.openRightPanelNodeTab;
    const closeRightPanelTab = storeActions?.closeRightPanelTab;
    const activateRightPanelTab = storeActions?.activateRightPanelTab;
    const moveRightPanelTab = storeActions?.moveRightPanelTab;
    const updateNode = storeActions?.updateNode;
    const updateGraph = storeActions?.updateGraph;
    const closeGraph = storeActions?.closeGraph;
    const toggleGraphExpanded = storeActions?.toggleGraphExpanded;
    const toggleSavedNode = storeActions?.toggleSavedNode;
    const setActiveDefinitionNode = storeActions?.setActiveDefinitionNode;
    const createAndAssignGraphDefinition = storeActions?.createAndAssignGraphDefinition;
    const cleanupOrphanedData = storeActions?.cleanupOrphanedData;

    // activeGraphId is now directly available as a prop

    /* // Remove Dummy Values
    const activeGraphId = null;
    const createNewGraph = () => console.log("Dummy createNewGraph");
    const setActiveGraph = (id) => console.log("Dummy setActiveGraph", id);
    const openRightPanelNodeTab = (id) => console.log("Dummy openRightPanelNodeTab", id);
    const closeRightPanelTab = (index) => console.log("Dummy closeRightPanelTab", index);
    const activateRightPanelTab = (index) => console.log("Dummy activateRightPanelTab", index);
    const moveRightPanelTab = (from, to) => console.log("Dummy moveRightPanelTab", from, to);
    const updateNode = (id, fn) => console.log("Dummy updateNode", id, fn);
    const updateGraph = (id, fn) => console.log("Dummy updateGraph", id, fn);
    */

    // Get openGraphTab explicitly if not already done (ensure it's available)
    const openGraphTab = storeActions?.openGraphTab;

    // Derive the array needed for the left panel grid (ALL graphs)
    const graphsForGrid = useMemo(() => {
      // Use getState() inside memo
      const currentGraphsMap = useGraphStore.getState().graphs;
      return Array.from(currentGraphsMap.values()).map(g => ({ id: g.id, name: g.name }));
    }, []); // No reactive dependencies needed?

    // ⚠️  CRITICAL: PANEL PERFORMANCE SAFEGUARD  ⚠️
    // 
    // NEVER add multiple individual useGraphStore subscriptions to this component!
    // This causes Panel jitter during pinch zoom operations.
    // 
    // If you need to add new store data, add it to the consolidated subscription below.
    // See the comment block around line 3170 for the proper pattern.
    //
    // Current individual subscriptions (KEEP THESE - they're the optimized pattern):
    const openGraphIds = useGraphStore(state => state.openGraphIds);

    // <<< Select expanded state reactively >>>
    const expandedGraphIds = useGraphStore(state => state.expandedGraphIds); // <<< Select the Set

    // <<< ADD BACK: Select last created ID reactively >>>
    const lastCreatedGraphId = useGraphStore(state => state.lastCreatedGraphId);

    // <<< Select graphs map reactively >>>
    const graphsMapRaw = useGraphStore(state => state.graphs);

    // <<< ADD: Select nodes and edges maps reactively >>>
    // PERFORMANCE FIX: Use individual selectors instead of subscribing to entire store
    // This prevents re-renders when viewport state (panOffset/zoomLevel) changes during zoom
    const nodePrototypesMapRaw = useGraphStore(state => state.nodePrototypes);
    const edgesMapRaw = useGraphStore(state => state.edges);
    const savedNodeIdsRaw = useGraphStore(state => state.savedNodeIds);
    // <<< ADD: Read activeDefinitionNodeId directly from the store >>>
    const activeDefinitionNodeId = useGraphStore(state => state.activeDefinitionNodeId);
    // <<< ADD: Select rightPanelTabs reactively >>>
    const rightPanelTabs = useGraphStore(state => state.rightPanelTabs);

    // Reserve bottom space for TypeList footer bar when visible
    const typeListMode = useGraphStore(state => state.typeListMode);

    // Add loading state check to prevent accessing store before it's ready
    const isUniverseLoading = useGraphStore(state => state.isUniverseLoading);
    const isUniverseLoaded = useGraphStore(state => state.isUniverseLoaded);
    
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/52d0fe28-158e-49a4-b331-f013fcb14181',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'Panel.jsx:522',message:'Panel individual subscriptions triggered',data:{hasNodePrototypes:!!nodePrototypesMapRaw,side},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'B'})}).catch(()=>{});
    // #endregion

    // Debug store subscription

    // ✅ END OF STORE SUBSCRIPTIONS - DO NOT ADD MORE INDIVIDUAL SUBSCRIPTIONS BELOW
    // If you need new store data, add it to the consolidated subscription pattern above

    // Treat verified Git engine as "ready" to avoid visible preload delay
    // Check if store is ready (but don't return early to avoid hooks rule violation)
    const emptyMap = useMemo(() => new Map(), []);
    const emptySet = useMemo(() => new Set(), []);

    const nodePrototypesMap = useMemo(() => {
      if (nodePrototypesMapRaw && typeof nodePrototypesMapRaw.get === 'function') {
        return nodePrototypesMapRaw;
      }
      return emptyMap;
    }, [nodePrototypesMapRaw, emptyMap]);

    const edgesMap = useMemo(() => {
      if (edgesMapRaw && typeof edgesMapRaw.get === 'function') {
        return edgesMapRaw;
      }
      return emptyMap;
    }, [edgesMapRaw, emptyMap]);

    const graphsMap = useMemo(() => {
      if (graphsMapRaw && typeof graphsMapRaw.get === 'function') {
        return graphsMapRaw;
      }
      return emptyMap;
    }, [graphsMapRaw, emptyMap]);

    const savedNodeIds = useMemo(() => {
      if (savedNodeIdsRaw instanceof Set) {
        return savedNodeIdsRaw;
      }
      if (Array.isArray(savedNodeIdsRaw)) {
        return new Set(savedNodeIdsRaw);
      }
      if (savedNodeIdsRaw && typeof savedNodeIdsRaw[Symbol.iterator] === 'function') {
        return new Set(Array.from(savedNodeIdsRaw));
      }
      return emptySet;
    }, [savedNodeIdsRaw, emptySet]);

    const hasNodePrototypes = nodePrototypesMapRaw && typeof nodePrototypesMapRaw.get === 'function';
    const isStoreReady = (!isUniverseLoading && isUniverseLoaded && hasNodePrototypes);

    const isTypeListVisible = typeListMode !== 'closed';
    const bottomSafeArea = isTypeListVisible ? HEADER_HEIGHT + 10 : 0; // footer height + small gap
    let effectiveBottomPadding = isTypeListVisible ? bottomSafeArea : 0; // refined after leftViewActive initializes

    // Derive saved nodes array reactively - savedNodeIds contains PROTOTYPE IDs
    const savedNodes = useMemo(() => {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/52d0fe28-158e-49a4-b331-f013fcb14181',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'Panel.jsx:590',message:'savedNodes useMemo recalculating',data:{savedCount:savedNodeIds?.size},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'E'})}).catch(()=>{});
      // #endregion
      return Array.from(savedNodeIds).map(prototypeId => {
        const prototype = nodePrototypesMap.get(prototypeId);
        if (prototype) {
          return {
            ...prototype,
            name: prototype.name || 'Untitled Node'
          };
        }
        return null;
      }).filter(Boolean);
    }, [savedNodeIds, nodePrototypesMap]);

    // Group saved nodes by their types
    const savedNodesByType = useMemo(() => {
      const groups = new Map();

      savedNodes.forEach(node => {
        // Get the type info for this node
        let typeId = node.typeNodeId;
        let typeInfo = null;

        if (typeId && nodePrototypesMap.has(typeId)) {
          // Node has a specific type
          const typeNode = nodePrototypesMap.get(typeId);
          typeInfo = {
            id: typeId,
            name: typeNode.name || 'Thing',
            color: typeNode.color || '#8B0000'
          };
        } else {
          // Node has no type or invalid type, use base "Thing"
          typeId = 'base-thing-prototype';
          typeInfo = {
            id: 'base-thing-prototype',
            name: 'Thing',
            color: '#8B0000' // Default maroon color for untyped nodes
          };
        }

        if (!groups.has(typeId)) {
          groups.set(typeId, {
            typeInfo,
            nodes: []
          });
        }

        groups.get(typeId).nodes.push(node);
      });

      return groups;
    }, [savedNodes, nodePrototypesMap]);

    // Derive all nodes array reactively - all node prototypes
    const allNodes = useMemo(() => {
      return Array.from(nodePrototypesMap.values()).map(prototype => ({
        ...prototype,
        name: prototype.name || 'Untitled Node'
      }));
    }, [nodePrototypesMap]);

    // Group all nodes by their types
    const allNodesByType = useMemo(() => {
      const groups = new Map();

      allNodes.forEach(node => {
        // Get the type info for this node
        let typeId = node.typeNodeId;
        let typeInfo = null;

        if (typeId && nodePrototypesMap.has(typeId)) {
          // Node has a specific type
          const typeNode = nodePrototypesMap.get(typeId);
          typeInfo = {
            id: typeId,
            name: typeNode.name || 'Thing',
            color: typeNode.color || '#8B0000'
          };
        } else {
          // Node has no type or invalid type, use base "Thing"
          typeId = 'base-thing-prototype';
          typeInfo = {
            id: 'base-thing-prototype',
            name: 'Thing',
            color: '#8B0000' // Default maroon color for untyped nodes
          };
        }

        // Add to appropriate group
        if (!groups.has(typeId)) {
          groups.set(typeId, {
            typeInfo,
            nodes: []
          });
        }
        groups.get(typeId).nodes.push(node);
      });

      console.log('[Panel] allNodesByType derived:', {
        totalGroups: groups.size,
        groups: Array.from(groups.entries()).map(([typeId, group]) => ({
          typeId,
          typeName: group.typeInfo.name,
          nodeCount: group.nodes.length,
          nodeIds: group.nodes.map(n => n.id)
        }))
      });

      return groups;
    }, [allNodes, nodePrototypesMap]);

    // <<< ADD Ref for the scrollable list container >>>
    const listContainerRef = useRef(null);

    // <<< ADD Ref to track previous open IDs >>>
    const prevOpenGraphIdsRef = useRef(openGraphIds);

    // <<< ADD BACK: Derive data for open graphs for the left panel list view >>>
    const openGraphsForList = useMemo(() => {
      return openGraphIds.map(id => {
        const graphData = graphsMap.get(id); // Use reactive graphsMap
        if (!graphData) return null; // Handle case where graph might not be found

        // Derive color from the defining node
        const definingNodeId = graphData.definingNodeIds?.[0];
        const definingNode = definingNodeId ? nodePrototypesMap.get(definingNodeId) : null;
        const graphColor = definingNode?.color || graphData.color || NODE_DEFAULT_COLOR;

        // Fetch nodes and edges using the REACTIVE maps
        const instances = graphData.instances ? Array.from(graphData.instances.values()) : [];
        const edgeIds = graphData.edgeIds || [];

        const nodes = instances.map(instance => {
          const prototype = nodePrototypesMap.get(instance.prototypeId);
          return {
            ...prototype,
            ...instance,
            // Always use prototype name, with fallback
            name: prototype?.name || 'Unnamed'
          };
        }).filter(Boolean);

        const edges = edgeIds.map(edgeId => edgesMap.get(edgeId)).filter(Boolean); // Use edgesMap
        return { ...graphData, color: graphColor, nodes, edges }; // Combine graph data with its nodes/edges
      }).filter(Boolean); // Filter out any nulls
    }, [openGraphIds, graphsMap, nodePrototypesMap, edgesMap]); // Add nodePrototypesMap

    // ALL STATE DECLARATIONS - MOVED TO TOP TO AVOID INITIALIZATION ERRORS
    // Panel width state
    const [panelWidth, setPanelWidth] = useState(INITIAL_PANEL_WIDTH);
    const [lastCustomWidth, setLastCustomWidth] = useState(INITIAL_PANEL_WIDTH);
    const [isWidthInitialized, setIsWidthInitialized] = useState(false);
    const [isAnimatingWidth, setIsAnimatingWidth] = useState(false);
    const [isHandleHover, setIsHandleHover] = useState(false);

    // Editing state
    const [editingTitle, setEditingTitle] = useState(false); // Used by right panel node tabs
    const [tempTitle, setTempTitle] = useState(''); // Used by right panel node tabs
    const [editingProjectTitle, setEditingProjectTitle] = useState(false); // Used by right panel home tab
    const [tempProjectTitle, setTempProjectTitle] = useState(''); // Used by right panel home tab

    // Left panel view state and collapsed sections
    const [leftViewActive, setLeftViewActive] = useState(
      side === 'left' && initialViewActive
        ? initialViewActive
        : 'library'
    ); // 'library', 'all', 'grid', 'federation', 'semantic', or 'ai'

    // Allow external control of view when prop changes
    useEffect(() => {
      if (side === 'left' && initialViewActive && initialViewActive !== leftViewActive) {
        setLeftViewActive(initialViewActive);
      }
    }, [initialViewActive, side]);
    // Apply consistent gap spacing across all views to prevent TypeList overlap
    const [sectionCollapsed, setSectionCollapsed] = useState({});
    const [sectionMaxHeights, setSectionMaxHeights] = useState({});

    // Color picker state
    const [colorPickerVisible, setColorPickerVisible] = useState(false);
    const [colorPickerPosition, setColorPickerPosition] = useState({ x: 0, y: 0 });
    const [colorPickerNodeId, setColorPickerNodeId] = useState(null);

    // Add new state for type creation dialog
    const [typeNamePrompt, setTypeNamePrompt] = useState({ visible: false, name: '', color: null, targetNodeId: null, targetNodeName: '' });

    // Add merge modal state for handling events from canvas/tabs
    const [showMergeModal, setShowMergeModal] = useState(false);

    // Refs
    const isResizing = useRef(false);
    const panelRef = useRef(null);
    const titleInputRef = useRef(null); // Used by right panel
    const projectTitleInputRef = useRef(null); // Used by right panel
    const tabBarRef = useRef(null); // Used by right panel
    const [isNodeHoveringTabBar, setIsNodeHoveringTabBar] = useState(false);
    const initialWidthsSet = useRef(false); // Ref to track initialization
    const resizeStartX = useRef(0);
    const resizeStartWidth = useRef(0);
    const projectBioTextareaRef = useRef(null);
    const nodeBioTextareaRef = useRef(null);
    const sectionContentRefs = useRef(new Map());

    const toggleSection = (name) => {
      // Simply toggle the collapsed state
      setSectionCollapsed(prev => ({ ...prev, [name]: !prev[name] }));
      console.log(`[toggleSection] Toggled section '${name}'. New collapsed state: ${!sectionCollapsed[name]}`);
    };

    // --- Semantic catalog loader hook ---
    const handleLoadWikidataCatalog = async (payload) => {
      try {
        const resp = await fetch('/api/catalog/wikidata-slice', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!resp.ok) {
          const text = await resp.text();
          console.warn('[Panel] Wikidata slice load failed:', resp.status, text);
          throw new Error(text || `HTTP ${resp.status}`);
        }
        const data = await resp.json().catch(() => ({}));
        console.log('[Panel] Wikidata slice load response:', data);
        return data;
      } catch (err) {
        console.warn('[Panel] Wikidata slice load error:', err);
        throw err;
      }
    };

    // AI view redirect removed - wizard is re-enabled

    // Debug section state
    useEffect(() => {
      // console.log('[Panel] Section state updated:', {
      //     sectionCollapsed,
      //     sectionMaxHeights,
      //     leftViewActive
      // });
    }, [sectionCollapsed, sectionMaxHeights, leftViewActive]);

    // <<< Effect to scroll to TOP when new item added >>>
    useEffect(() => {
      // Only scroll if it's the left panel and the ref exists
      if (side === 'left' && listContainerRef.current) {
        // Check if the first ID is new compared to the previous render
        const firstId = openGraphIds.length > 0 ? openGraphIds[0] : null;
        const prevFirstId = prevOpenGraphIdsRef.current.length > 0 ? prevOpenGraphIdsRef.current[0] : null;

        // Only scroll if the first ID actually changed (and isn't null)
        if (firstId && firstId !== prevFirstId) {
          const container = listContainerRef.current;
          // Remove requestAnimationFrame to start scroll sooner
          // requestAnimationFrame(() => {
          if (container) {
            console.log(`[Panel Effect] New item detected at top. Scrolling list container to top. Current scrollTop: ${container.scrollTop}`);
            container.scrollTo({ top: 0, behavior: 'smooth' }); // <<< Keep smooth
          }
          // });
        }
      }

      // Update the ref for the next render *after* the effect runs
      prevOpenGraphIdsRef.current = openGraphIds;

      // Run when openGraphIds array reference changes OR side changes
    }, [openGraphIds, side]);

    // Effect to update maxHeights for all sections when content changes or visibility toggles
    useEffect(() => {
      // Don't run if panelWidth hasn't been initialized yet
      if (!isWidthInitialized) {
        return;
      }

      const newMaxHeights = {};

      // Calculate heights for both saved nodes and all nodes (for All Things tab)
      const allTypeGroups = new Map([...savedNodesByType, ...allNodesByType]);

      allTypeGroups.forEach((group, typeId) => {
        const sectionRef = sectionContentRefs.current.get(typeId);
        let maxHeight = '0px'; // Default to collapsed height

        if (sectionRef) {
          const currentScrollHeight = sectionRef.scrollHeight;
          const potentialOpenHeight = `${currentScrollHeight}px`;

          // Decide whether to use the calculated height or 0px
          if (!sectionCollapsed[typeId]) {
            // Section is OPEN, use the calculated height
            maxHeight = potentialOpenHeight;
          } else {
            // Section is CLOSED, maxHeight remains '0px'
            maxHeight = '0px';
          }
        } else {
          // Fallback if ref isn't ready (might happen on initial render)
          maxHeight = sectionCollapsed[typeId] ? '0px' : '500px';
        }

        newMaxHeights[typeId] = maxHeight;
      });

      // Set the state
      setSectionMaxHeights(newMaxHeights);

    }, [savedNodesByType, allNodesByType, sectionCollapsed, panelWidth, isWidthInitialized]); // Rerun when savedNodesByType, allNodesByType, collapsed state, or panel width changes



    // Effect to close color pickers when switching between views/contexts
    useEffect(() => {
      // Close any open color pickers when panel side or context changes
      setColorPickerVisible(false);
      setColorPickerNodeId(null);
    }, [leftViewActive]); // Close when switching left panel views

    // Event listener for opening merge modal from canvas/tabs
    useEffect(() => {
      const handleOpenMergeModal = () => {
        console.log('[Panel] Opening merge modal from external trigger');
        // Switch to saved tab and open merge modal
        if (side === 'right') {
          storeActions.setActiveTab('saved');
          setShowMergeModal(true);
        } else if (side === 'left') {
          setLeftViewActive('library');
          // For left panel, we'll use the showDuplicateManager from LeftLibraryView
          // We need to trigger it somehow - for now we'll just console log
          console.log('[Panel] Left panel merge modal triggered - switching to library view');
        }
      };

      window.addEventListener('openMergeModal', handleOpenMergeModal);
      return () => window.removeEventListener('openMergeModal', handleOpenMergeModal);
    }, [side, storeActions]);

    // Event listener: open Semantic Discovery (triggered by text-search icon)
    useEffect(() => {
      const handler = (e) => {
        try {
          const query = e?.detail?.query;
          if (side === 'left') {
            setLeftViewActive('semantic');
            if (query) {
              // Retry until the view registers triggerSemanticSearch
              let attempts = 0;
              const maxAttempts = 20; // ~1s at 50ms intervals
              const intervalId = setInterval(() => {
                attempts += 1;
                if (typeof window !== 'undefined' && typeof window.triggerSemanticSearch === 'function') {
                  try { window.triggerSemanticSearch(query); } catch { }
                  clearInterval(intervalId);
                } else if (attempts >= maxAttempts) {
                  clearInterval(intervalId);
                }
              }, 50);
            }
          } else if (side === 'right') {
            window.dispatchEvent(new CustomEvent('openSemanticDiscovery', { detail: { query } }));
          }
        } catch { }
      };
      window.addEventListener('openSemanticDiscovery', handler);
      return () => window.removeEventListener('openSemanticDiscovery', handler);
    }, [side]);

    useEffect(() => {
      // Load initial widths from localStorage ONCE on mount
      if (!initialWidthsSet.current) {
        // Check if NodeCanvas has already set a width for this panel
        const checkNodeCanvasWidth = () => {
          // Try to get the width that NodeCanvas might have already set
          const nodeCanvasWidth = side === 'left' ?
            JSON.parse(localStorage.getItem('panelWidth_left') || 'null') :
            JSON.parse(localStorage.getItem('panelWidth_right') || 'null');

          if (nodeCanvasWidth && typeof nodeCanvasWidth === 'number' && nodeCanvasWidth >= MIN_PANEL_WIDTH) {
            // Use NodeCanvas width if available
            setPanelWidth(nodeCanvasWidth);
            setLastCustomWidth(nodeCanvasWidth);
          } else {
            // Fall back to our own localStorage or default
            const initialWidth = getInitialWidth(side, INITIAL_PANEL_WIDTH);
            const initialLastCustom = getInitialLastCustomWidth(side, INITIAL_PANEL_WIDTH);
            setPanelWidth(initialWidth);
            setLastCustomWidth(initialLastCustom);
          }
          setIsWidthInitialized(true);
          initialWidthsSet.current = true; // Mark as set
        };

        // Small delay to ensure NodeCanvas has initialized first
        const timer = setTimeout(checkNodeCanvasWidth, 50);
        return () => clearTimeout(timer);
      }
    }, [side]); // Run once on mount (and if side changes, though unlikely)

    useEffect(() => {
      if (editingTitle && titleInputRef.current) {
        const inputElement = titleInputRef.current;

        // Function to calculate and set width
        const updateInputWidth = () => {
          const text = inputElement.value; // Use current value from input directly
          const style = window.getComputedStyle(inputElement);

          const tempSpan = document.createElement('span');
          tempSpan.style.font = style.font; // Includes family, size, weight, etc.
          tempSpan.style.letterSpacing = style.letterSpacing;
          tempSpan.style.visibility = 'hidden';
          tempSpan.style.position = 'absolute';
          tempSpan.style.whiteSpace = 'pre'; // Handles spaces correctly

          // Use a non-empty string for measurement if text is empty
          tempSpan.innerText = text || ' '; // Measure at least a space to get padding/border accounted for by font style

          document.body.appendChild(tempSpan);
          const textWidth = tempSpan.offsetWidth;
          document.body.removeChild(tempSpan);

          const paddingLeft = parseFloat(style.paddingLeft) || 0;
          const paddingRight = parseFloat(style.paddingRight) || 0;
          const borderLeft = parseFloat(style.borderLeftWidth) || 0;
          const borderRight = parseFloat(style.borderRightWidth) || 0;

          // Total width is text width (which includes its own padding if span styled so) 
          // or text width + input's padding + input's border
          // Let's try with textWidth from span (assuming span has no extra padding/border) + structural parts of input
          let newWidth = textWidth + paddingLeft + paddingRight + borderLeft + borderRight;

          const minWidth = 40; // Minimum pixel width for the input
          if (newWidth < minWidth) {
            newWidth = minWidth;
          }

          inputElement.style.width = `${newWidth}px`;
        };

        inputElement.focus();
        inputElement.select();
        updateInputWidth(); // Initial width set

        inputElement.addEventListener('input', updateInputWidth);

        // Cleanup
        return () => {
          inputElement.removeEventListener('input', updateInputWidth);
          // Optionally reset width if the component is re-rendered without editingTitle
          // This might be needed if the style.width persists undesirably
          if (inputElement) { // Check if still mounted
            inputElement.style.width = 'auto'; // Or initial fixed width if it had one
          }
        };
      } else if (titleInputRef.current) {
        // If editingTitle becomes false, reset width for the next time it's opened
        titleInputRef.current.style.width = 'auto';
      }
    }, [editingTitle]); // Effect for focus, select, and dynamic width

    useEffect(() => {
      if (editingProjectTitle && projectTitleInputRef.current) {
        const inputElement = projectTitleInputRef.current;

        const updateInputWidth = () => {
          const text = inputElement.value;
          const style = window.getComputedStyle(inputElement);
          const tempSpan = document.createElement('span');
          tempSpan.style.font = style.font;
          tempSpan.style.letterSpacing = style.letterSpacing;
          tempSpan.style.visibility = 'hidden';
          tempSpan.style.position = 'absolute';
          tempSpan.style.whiteSpace = 'pre';
          tempSpan.innerText = text || ' ';
          document.body.appendChild(tempSpan);
          const textWidth = tempSpan.offsetWidth;
          document.body.removeChild(tempSpan);

          const paddingLeft = parseFloat(style.paddingLeft) || 0;
          const paddingRight = parseFloat(style.paddingRight) || 0;
          const borderLeft = parseFloat(style.borderLeftWidth) || 0;
          const borderRight = parseFloat(style.borderRightWidth) || 0;
          let newWidth = textWidth + paddingLeft + paddingRight + borderLeft + borderRight;
          const minWidth = 60; // Slightly larger min-width for project title?
          if (newWidth < minWidth) {
            newWidth = minWidth;
          }
          inputElement.style.width = `${newWidth}px`;
        };

        inputElement.focus();
        inputElement.select();
        updateInputWidth(); // Initial width set

        inputElement.addEventListener('input', updateInputWidth);

        return () => {
          inputElement.removeEventListener('input', updateInputWidth);
          if (inputElement) {
            inputElement.style.width = 'auto';
          }
        };
      } else if (projectTitleInputRef.current) {
        projectTitleInputRef.current.style.width = 'auto';
      }
    }, [editingProjectTitle]);

    // Exposed so NodeCanvas can open tabs
    const openNodeTab = (nodeId) => {
      if (side !== 'right') return;
      // console.log(`[Panel ${side}] Imperative openNodeTab called for ${nodeId}`);
      openRightPanelNodeTab(nodeId);
      setEditingTitle(false);
    };

    useImperativeHandle(ref, () => ({
      openNodeTab,
    }));

    // --- Resize Handlers (Reordered definitions) ---
    const updateWidthForClientX = useCallback((clientX) => {
      const dx = clientX - resizeStartX.current;
      let newWidth;
      if (side === 'left') {
        newWidth = resizeStartWidth.current + dx;
      } else {
        newWidth = resizeStartWidth.current - dx;
      }
      const maxWidth = window.innerWidth / 2;
      const clampedWidth = Math.max(MIN_PANEL_WIDTH, Math.min(newWidth, maxWidth));
      setPanelWidth(clampedWidth);
    }, [side]);

    const handleResizeMouseMove = useCallback((e) => {
      if (!isResizing.current) return;
      updateWidthForClientX(e.clientX);
    }, [updateWidthForClientX]);

    const handleResizeTouchMove = useCallback((e) => {
      if (!isResizing.current) return;
      if (e.touches && e.touches.length > 0) {
        updateWidthForClientX(e.touches[0].clientX);
      }
    }, [updateWidthForClientX]);

    const handleResizeMouseUp = useCallback(() => {
      if (isResizing.current) {
        isResizing.current = false;
        window.removeEventListener('mousemove', handleResizeMouseMove);
        window.removeEventListener('touchmove', handleResizeTouchMove);
        window.removeEventListener('mouseup', handleResizeMouseUp);
        window.removeEventListener('touchend', handleResizeMouseUp);
        document.body.style.userSelect = '';
        document.body.style.cursor = '';

        // Wrap state update and localStorage access in requestAnimationFrame
        requestAnimationFrame(() => {
          try {
            const finalWidth = panelRef.current?.offsetWidth; // Get final width
            if (finalWidth) {
              // Save current width
              localStorage.setItem(`panelWidth_${side}`, JSON.stringify(finalWidth));
              // If it's not the default AND different from the current lastCustomWidth, save as last custom width
              if (finalWidth !== INITIAL_PANEL_WIDTH && finalWidth !== lastCustomWidth) {
                setLastCustomWidth(finalWidth); // Update state inside RAF only if different
                localStorage.setItem(`lastCustomPanelWidth_${side}`, JSON.stringify(finalWidth));
              }
              // Notify global listeners (e.g., NodeCanvas overlay resizers)
              try {
                window.dispatchEvent(new CustomEvent('panelWidthChanged', { detail: { side, width: finalWidth } }));
              } catch { }
            }
          } catch (error) {
            console.error(`Error saving panelWidth_${side} to localStorage:`, error);
          }
        });
      }
    }, [side, handleResizeMouseMove, handleResizeTouchMove, lastCustomWidth]); // <<< Added lastCustomWidth to dependencies

    const handleResizeMouseDown = useCallback((e) => {
      e.preventDefault();
      e.stopPropagation();
      isResizing.current = true;
      resizeStartX.current = e.clientX;
      resizeStartWidth.current = panelRef.current?.offsetWidth || panelWidth;
      window.addEventListener('mousemove', handleResizeMouseMove);
      window.addEventListener('mouseup', handleResizeMouseUp);
      window.addEventListener('touchmove', handleResizeTouchMove, { passive: false });
      window.addEventListener('touchend', handleResizeMouseUp);
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'col-resize';
    }, [handleResizeMouseMove, handleResizeMouseUp, handleResizeTouchMove, panelWidth]);

    const handleResizeTouchStart = useCallback((e) => {
      if (!(e.touches && e.touches.length > 0)) return;
      e.preventDefault();
      e.stopPropagation();
      isResizing.current = true;
      resizeStartX.current = e.touches[0].clientX;
      resizeStartWidth.current = panelRef.current?.offsetWidth || panelWidth;
      window.addEventListener('touchmove', handleResizeTouchMove, { passive: false });
      window.addEventListener('touchend', handleResizeMouseUp);
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'col-resize';
    }, [handleResizeTouchMove, handleResizeMouseUp, panelWidth]);

    // --- Double Click Handler ---
    const handleHeaderDoubleClick = useCallback((e) => {
      // console.log('[Panel DblClick] Handler triggered');
      const target = e.target;

      // Check if the click originated within a draggable tab element
      if (target.closest('.panel-tab')) {
        // console.log('[Panel DblClick] Click originated inside a .panel-tab, exiting.');
        return;
      }

      // If we reach here, the click was on the header bar itself or empty space within it.
      // console.log('[Panel DblClick] Click target OK (not inside a tab).');

      let newWidth;
      // console.log('[Panel DblClick] Before toggle:', { currentWidth: panelWidth, lastCustom: lastCustomWidth });

      if (panelWidth === INITIAL_PANEL_WIDTH) {
        // Toggle to last custom width (if it's different)
        newWidth = (lastCustomWidth !== INITIAL_PANEL_WIDTH) ? lastCustomWidth : panelWidth;
        // console.log('[Panel DblClick] Was default, toggling to last custom (or current if same):', newWidth);
      } else {
        // Current width is custom, save it as last custom and toggle to default
        // console.log('[Panel DblClick] Was custom, saving current as last custom:', panelWidth);
        setLastCustomWidth(panelWidth); // Update state
        try { // Separate try/catch for this specific save
          localStorage.setItem(`lastCustomPanelWidth_${side}`, JSON.stringify(panelWidth));
        } catch (error) {
          console.error(`Error saving lastCustomPanelWidth_${side} before toggle:`, error);
        }
        newWidth = INITIAL_PANEL_WIDTH;
        // console.log('[Panel DblClick] Toggling to default:', newWidth);
      }

      if (newWidth !== panelWidth) {
        setIsAnimatingWidth(true);
        setPanelWidth(newWidth);
        try {
          localStorage.setItem(`panelWidth_${side}`, JSON.stringify(newWidth));
          // Broadcast change so external overlays can sync
          try {
            window.dispatchEvent(new CustomEvent('panelWidthChanged', { detail: { side, width: newWidth } }));
          } catch { }
        } catch (error) {
          console.error(`Error saving panelWidth_${side} after double click:`, error);
        }
      } else {
        // console.log('[Panel DblClick] Width did not change, no update needed.');
      }
    }, [panelWidth, lastCustomWidth, side]);

    // Listen for external resizer overlay updates from NodeCanvas for low-latency sync
    useEffect(() => {
      const onChanging = (e) => {
        if (!e?.detail) return;
        const { side: evtSide, width } = e.detail;
        if (evtSide === side && typeof width === 'number') {
          setPanelWidth(width);
        }
      };
      const onChanged = (e) => {
        if (!e?.detail) return;
        const { side: evtSide, width } = e.detail;
        if (evtSide === side && typeof width === 'number') {
          setPanelWidth(width);
          try {
            localStorage.setItem(`panelWidth_${side}`, JSON.stringify(width));
          } catch { }
        }
      };
      window.addEventListener('panelWidthChanging', onChanging);
      window.addEventListener('panelWidthChanged', onChanged);
      return () => {
        window.removeEventListener('panelWidthChanging', onChanging);
        window.removeEventListener('panelWidthChanged', onChanged);
      };
    }, [side]);

    // Effect for cleanup
    useEffect(() => {
      // Cleanup function to remove listeners if component unmounts while resizing
      return () => {
        if (isResizing.current) {
          window.removeEventListener('mousemove', handleResizeMouseMove);
          window.removeEventListener('mouseup', handleResizeMouseUp);
          document.body.style.userSelect = '';
          document.body.style.cursor = '';
        }
      };
    }, [handleResizeMouseMove, handleResizeMouseUp]);

    // Scrollbar hover detection
    const handleScrollbarMouseEnter = useCallback((e) => {
      // Check if mouse is over the scrollbar area (right edge of the element)
      const rect = e.currentTarget.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const scrollbarWidth = 20; // Should match CSS scrollbar width

      if (mouseX >= rect.width - scrollbarWidth) {
        setIsHoveringScrollbar(true);
        if (scrollbarHoverTimeoutRef.current) {
          clearTimeout(scrollbarHoverTimeoutRef.current);
        }
      }
    }, []);

    const handleScrollbarMouseMove = useCallback((e) => {
      // Check if mouse is still over the scrollbar area
      const rect = e.currentTarget.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const scrollbarWidth = 20; // Should match CSS scrollbar width

      const isOverScrollbar = mouseX >= rect.width - scrollbarWidth;

      if (isOverScrollbar && !isHoveringScrollbar) {
        setIsHoveringScrollbar(true);
        if (scrollbarHoverTimeoutRef.current) {
          clearTimeout(scrollbarHoverTimeoutRef.current);
        }
      } else if (!isOverScrollbar && isHoveringScrollbar) {
        // Start timeout to fade scrollbar after leaving
        scrollbarHoverTimeoutRef.current = setTimeout(() => {
          setIsHoveringScrollbar(false);
        }, 300); // 300ms delay before fading
      }
    }, [isHoveringScrollbar]);

    const handleScrollbarMouseLeave = useCallback(() => {
      // Start timeout to fade scrollbar after leaving the element
      scrollbarHoverTimeoutRef.current = setTimeout(() => {
        setIsHoveringScrollbar(false);
      }, 300); // 300ms delay before fading
    }, []);

    // Cleanup scrollbar hover timeout on unmount
    useEffect(() => {
      return () => {
        if (scrollbarHoverTimeoutRef.current) {
          clearTimeout(scrollbarHoverTimeoutRef.current);
        }
      };
    }, []);

    // <<< Add Effect to reset animation state after transition >>>
    useEffect(() => {
      let timeoutId = null;
      if (isAnimatingWidth) {
        // Set timeout matching the transition duration
        timeoutId = setTimeout(() => {
          setIsAnimatingWidth(false);
        }, 200); // Duration of width transition
      }
      // Cleanup the timeout if the component unmounts or state changes again
      return () => clearTimeout(timeoutId);
    }, [isAnimatingWidth]);
    // --- End Resize Handlers & related effects ---

    // --- Determine Active View/Tab --- 
    const isUltraSlim = panelWidth <= 275;
    // Get tabs reactively if side is 'right'
    const activeRightPanelTab = useMemo(() => {
      if (side !== 'right') return null;
      return rightPanelTabs.find((t) => t.isActive);
    }, [side, rightPanelTabs]); // Depend on side and the reactive tabs

    // Derive nodes for active graph on right side (Calculate on every render)
    const activeGraphNodes = useMemo(() => {
      if (side !== 'right' || !activeGraphId) return [];
      // Use the new hydrated selector which is more efficient
      return getHydratedNodesForGraph(activeGraphId)(useGraphStore.getState());
    }, [activeGraphId, side]); // Removed unnecessary dependencies

    // Auto-resize project bio textarea when content changes or tab becomes active
    React.useLayoutEffect(() => {
      if (side === 'right' && activeRightPanelTab?.type === 'home') {
        autoResizeTextarea(projectBioTextareaRef);
      }
    }, [side, activeRightPanelTab?.type, graphDescription]);

    // Auto-resize node bio textarea when content changes or tab becomes active
    React.useLayoutEffect(() => {
      if (side === 'right' && activeRightPanelTab?.type === 'node') {
        // Trigger auto-resize immediately without delay
        autoResizeTextarea(nodeBioTextareaRef);
      }
    }, [side, activeRightPanelTab?.type, activeRightPanelTab?.nodeId, activeGraphId, nodeDefinitionIndices, graphsMap]);

    // --- Action Handlers defined earlier --- 
    const handleAddImage = (nodeId) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (loadEvent) => {
          const fullImageSrc = loadEvent.target?.result;
          if (typeof fullImageSrc !== 'string') return;
          const img = new Image();
          img.onload = async () => {
            try {
              const aspectRatio = (img.naturalHeight > 0 && img.naturalWidth > 0) ? img.naturalHeight / img.naturalWidth : 1;
              const thumbSrc = await generateThumbnail(fullImageSrc, THUMBNAIL_MAX_DIMENSION);
              const nodeDataToSave = { imageSrc: fullImageSrc, thumbnailSrc: thumbSrc, imageAspectRatio: aspectRatio };
              console.log('Calling store updateNodePrototype with image data:', nodeId, nodeDataToSave); // Keep log for this one
              // Call store action directly (using prop)
              storeActions.updateNodePrototype(nodeId, draft => { Object.assign(draft, nodeDataToSave); });
            } catch (error) {
              // console.error("Thumbnail/save failed:", error);
              // Handle error appropriately, e.g., show a message to the user
            }
          };
          img.onerror = (error) => {
            // console.error('Image load failed:', error);
            // Handle error appropriately
          };
          img.src = fullImageSrc;
        };
        reader.onerror = (error) => {
          // console.error('FileReader failed:', error);
          // Handle error appropriately
        };
        reader.readAsDataURL(file);
      };
      input.click();
    };

    const handleBioChange = (nodeId, newBio) => {
      if (!activeGraphId) return;

      // Get the node data to check if it has definitions
      const nodeData = nodePrototypesMap.get(nodeId);

      // If node has definitions, update the current definition graph's description
      if (nodeData && nodeData.definitionGraphIds && nodeData.definitionGraphIds.length > 0) {
        // Get the context-specific definition index
        const contextKey = `${nodeId}-${activeGraphId}`;
        const currentIndex = nodeDefinitionIndices.get(contextKey) || 0;

        // Get the graph ID for the current definition
        const currentDefinitionGraphId = nodeData.definitionGraphIds[currentIndex] || nodeData.definitionGraphIds[0];

        // Update the definition graph's description
        if (currentDefinitionGraphId) {
          updateGraph(currentDefinitionGraphId, draft => { draft.description = newBio; });
          return;
        }
      }

      // Fallback: update the node's own description
      storeActions.updateNodePrototype(nodeId, draft => { draft.description = newBio; });
    };

    const commitProjectTitleChange = () => {
      // Get CURRENT activeGraphId directly from store
      const currentActiveId = useGraphStore.getState().activeGraphId;
      if (!currentActiveId) {
        console.warn("commitProjectTitleChange: No active graph ID found in store.");
        setEditingProjectTitle(false); // Still stop editing
        return;
      }
      const newName = tempProjectTitle.trim() || 'Untitled';
      // Call store action directly (using prop and current ID)
      updateGraph(currentActiveId, draft => { draft.name = newName; });
      setEditingProjectTitle(false);
    };

    // Handle color picker change
    const handleColorChange = (newColor) => {
      if (colorPickerNodeId && storeActions?.updateNodePrototype) {
        storeActions.updateNodePrototype(colorPickerNodeId, draft => {
          draft.color = newColor;
        });
      }
    };

    // Handle opening color picker with toggle behavior
    const handleOpenColorPicker = (nodeId, iconElement, event) => {
      event.stopPropagation();

      // If already open for the same node, close it (toggle behavior)
      if (colorPickerVisible && colorPickerNodeId === nodeId) {
        setColorPickerVisible(false);
        setColorPickerNodeId(null);
        return;
      }

      // Open color picker - align right edges
      const rect = iconElement.getBoundingClientRect();
      setColorPickerPosition({ x: rect.right, y: rect.bottom });
      setColorPickerNodeId(nodeId);
      setColorPickerVisible(true);
    };

    // Handle closing color picker
    const handleCloseColorPicker = () => {
      setColorPickerVisible(false);
      setColorPickerNodeId(null);
    };

    // Auto-resize textarea helper function
    const autoResizeTextarea = (textareaRef) => {
      if (textareaRef.current) {
        const textarea = textareaRef.current;
        // Reset height to auto to get the scrollHeight
        textarea.style.height = 'auto';
        // Set height to scrollHeight (content height) with min and max bounds
        const minHeight = 60; // Minimum height in pixels
        const maxHeight = 300; // Maximum height in pixels
        const newHeight = Math.min(Math.max(textarea.scrollHeight, minHeight), maxHeight);
        textarea.style.height = `${newHeight}px`;
      }
    };

    // Add new handler for type creation
    const handleOpenTypeDialog = (nodeId, clickEvent) => {
      // Prevent opening type dialog for the base "Thing" type
      if (nodeId === 'base-thing-prototype') {
        console.log(`Cannot change type of base "Thing" - it must remain the fundamental type.`);
        return;
      }

      const nodeName = nodePrototypesMap.get(nodeId)?.name || 'this thing';
      // Truncate long node names to keep dialog manageable
      const truncatedNodeName = nodeName.length > 20 ? nodeName.substring(0, 20) + '...' : nodeName;

      setTypeNamePrompt({
        visible: true,
        name: '',
        color: null,
        targetNodeId: nodeId,
        targetNodeName: truncatedNodeName
      });
    };

    const handleCloseTypePrompt = () => {
      setTypeNamePrompt({ visible: false, name: '', color: null, targetNodeId: null, targetNodeName: '' });
    };

    const handleTypeNodeSelection = (nodeId) => {
      handleOpenTypeDialog(nodeId);
    };


    // --- Generate Content based on Side ---
    let panelContent = null;
    if (side === 'left') {
      if (ENABLE_ALL_THINGS_TAB && leftViewActive === 'all') {
        panelContent = (
          <LeftAllThingsView
            allNodesByType={allNodesByType}
            sectionCollapsed={sectionCollapsed}
            sectionMaxHeights={sectionMaxHeights}
            toggleSection={toggleSection}
            panelWidth={panelWidth}
            sectionContentRefs={sectionContentRefs}
            activeDefinitionNodeId={activeDefinitionNodeId}
            openGraphTab={openGraphTab}
            createAndAssignGraphDefinition={createAndAssignGraphDefinition}
            openRightPanelNodeTab={openRightPanelNodeTab}
            storeActions={storeActions}
          />
        );
      } else if (leftViewActive === 'library') {
        panelContent = (
          <LeftLibraryView
            savedNodesByType={savedNodesByType}
            sectionCollapsed={sectionCollapsed}
            sectionMaxHeights={sectionMaxHeights}
            toggleSection={toggleSection}
            panelWidth={panelWidth}
            sectionContentRefs={sectionContentRefs}
            activeDefinitionNodeId={activeDefinitionNodeId}
            openGraphTab={openGraphTab}
            createAndAssignGraphDefinition={createAndAssignGraphDefinition}
            toggleSavedNode={toggleSavedNode}
            openRightPanelNodeTab={openRightPanelNodeTab}
          />
        );
      } else if (leftViewActive === 'grid') {
        const handleGridItemClick = (graphId) => { if (leftViewActive === 'grid') setActiveGraph(graphId); };
        panelContent = (
          <LeftGridView
            openGraphsForList={openGraphsForList}
            panelWidth={panelWidth}
            listContainerRef={listContainerRef}
            activeGraphId={activeGraphId}
            expandedGraphIds={expandedGraphIds}
            handleGridItemClick={handleGridItemClick}
            closeGraph={closeGraph}
            toggleGraphExpanded={toggleGraphExpanded}
            createNewGraph={createNewGraph}
          />
        );
      } else if (leftViewActive === 'federation') {
        // Git-Native Federation view
        panelContent = (
          <div className="panel-content-inner" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <GitNativeFederation />
          </div>
        );
      } else if (leftViewActive === 'semantic') {
        // Semantic Discovery view - concept discovery engine
        panelContent = (
          <LeftSemanticDiscoveryView
            storeActions={storeActions}
            nodePrototypesMap={nodePrototypesMap}
            openRightPanelNodeTab={openRightPanelNodeTab}
            rightPanelTabs={rightPanelTabs}
            activeDefinitionNodeId={activeDefinitionNodeId}
            selectedInstanceIds={selectedInstanceIds}
            hydratedNodes={hydratedNodes}
            onLoadWikidataCatalog={handleLoadWikidataCatalog}
          />
        );
      } else if (leftViewActive === 'ai') {
        panelContent = (
          <LeftAIView
            compact={panelWidth < 300}
            activeGraphId={activeGraphId}
            graphsMap={graphsMap}
          />
        );
      }
    } else { // side === 'right'
      if (!activeRightPanelTab) {
        panelContent = <div className="panel-content-inner">No tab selected...</div>;
      } else if (activeRightPanelTab.type === 'home') {
        panelContent = (
          <div className="panel-content-inner">
            <PanelContentWrapper
              tabType="home"
              storeActions={storeActions}
              onFocusChange={onFocusChange}
              onTypeSelect={handleTypeNodeSelection}
              onStartHurtleAnimationFromPanel={onStartHurtleAnimationFromPanel}
              isUltraSlim={isUltraSlim}
            />
          </div>
        );
      } else if (activeRightPanelTab.type === 'node') {
        const nodeId = activeRightPanelTab.nodeId;
        // --- Fetch node data globally using the tab's nodeId ---
        const nodeData = useGraphStore.getState().nodePrototypes.get(nodeId);

        if (!nodeData) {
          // Node data doesn't exist globally - error case
          panelContent = (
            <div style={{ padding: '10px', color: '#aaa', fontFamily: "'EmOne', sans-serif" }}>Node data not found globally...</div>
          );
        } else {
          panelContent = (
            <div className="panel-content-inner">
              <PanelContentWrapper
                tabType="node"
                nodeId={nodeId}
                storeActions={storeActions}
                onFocusChange={onFocusChange}
                onTypeSelect={handleTypeNodeSelection}
                onStartHurtleAnimationFromPanel={onStartHurtleAnimationFromPanel}
                isUltraSlim={isUltraSlim}
              />
            </div>
          );
        }
      }
    }

    // --- Positioning and Animation Styles based on side ---
    const positionStyle = side === 'left' ? { left: 0 } : { right: 0 };
    const transformStyle = side === 'left'
      ? (isExpanded ? 'translateX(0%)' : 'translateX(-100%)')
      : (isExpanded ? 'translateX(0%)' : 'translateX(100%)');

    // Dynamically build transition string, removing backgroundColor
    const transitionStyle = `transform 0.2s ease${isAnimatingWidth ? ', width 0.2s ease' : ''}`;

    const handleBaseColor = '#260000'; // header maroon
    const handleOpacity = isResizing.current ? 1 : (isHandleHover ? 0.18 : 0.08);
    const handleStyle = {
      position: 'absolute',
      top: 0,
      bottom: 0,
      width: '14px',
      cursor: 'col-resize',
      zIndex: 10001,
      backgroundColor: `rgba(38,0,0,${handleOpacity})`,
      transition: 'background-color 0.15s ease, opacity 0.15s ease',
      borderRadius: '2px',
      touchAction: 'none'
    };
    if (side === 'left') {
      handleStyle.right = '-6px';
    } else { // side === 'right'
      handleStyle.left = '-6px';
    }

    // --- Tab Bar Scroll Handler ---
    const handleTabBarWheel = useCallback((e) => {

      if (tabBarRef.current) {
        e.preventDefault();
        e.stopPropagation();

        const element = tabBarRef.current;


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
          console.log('[Tab Wheel] Attempting to scroll by:', scrollChange);
          element.scrollLeft += scrollChange;
          console.log('[Tab Wheel] New scrollLeft:', element.scrollLeft);
        } else {
          console.log('[Tab Wheel] No overflow - not scrolling');
        }
      } else {
        console.log('[Tab Wheel] No ref found!');
      }
    }, []); // No dependencies needed since it only uses refs

    // --- Effect to manually add non-passive wheel listener ---
    useEffect(() => {
      const tabBarNode = tabBarRef.current;
      console.log('[Tab Wheel Effect] Running with:', {
        hasNode: !!tabBarNode,
        side,
        isExpanded,
        nodeTagName: tabBarNode?.tagName,
        nodeClassList: tabBarNode?.classList.toString()
      });

      if (tabBarNode && side === 'right' && isExpanded) {
        console.log('[Tab Wheel Effect] Adding wheel listener to:', tabBarNode);
        // Add listener with passive: false to allow preventDefault
        tabBarNode.addEventListener('wheel', handleTabBarWheel, { passive: false });

        // Cleanup function
        return () => {
          console.log('[Tab Wheel Effect] Removing wheel listener');
          tabBarNode.removeEventListener('wheel', handleTabBarWheel, { passive: false });
        };
      }
    }, [side, isExpanded, handleTabBarWheel]); // Re-run when dependencies change

    // Drop zone for creating tabs from dragged nodes
    const [{ isOver }, tabDropZone] = useDrop({
      accept: 'SPAWNABLE_NODE',
      drop: (item) => {
        const nodeId = item.nodeId || item.prototypeId;
        if (nodeId && side === 'right') {
          // Create a new tab for the dropped node
          storeActions.openRightPanelNodeTab(nodeId);
        }
      },
      collect: (monitor) => ({
        isOver: !!monitor.isOver(),
      }),
    });

    // Update hover state for visual feedback
    useEffect(() => {
      setIsNodeHoveringTabBar(isOver);
    }, [isOver]);

    // Show loading state if store is not ready
    return (
      <>
        {/* Pass side prop to ToggleButton */}
        <ToggleButton isExpanded={isExpanded} onClick={onToggleExpand} side={side} />

        {/* Main Sliding Panel Container */}
        <div
          ref={panelRef} // Assign ref here
          data-panel-ready={isStoreReady ? 'ready' : 'loading'}
          style={{
            position: 'fixed',
            top: HEADER_HEIGHT,
            ...positionStyle,
            bottom: 0,
            width: `${panelWidth}px`, // Use state variable for width
            backgroundColor: '#bdb5b5', // <<< Set back to static color
            boxShadow: '0 2px 5px rgba(0, 0, 0, 0.2)',
            zIndex: 10000,
            overflow: 'hidden', // Keep hidden to clip content
            display: 'flex',
            flexDirection: 'column',
            transform: transformStyle,
            transition: transitionStyle, // Animate transform and width
          }}
          onTouchStart={(e) => e.stopPropagation()}
        >
          {/* Resize Handle disabled; handled by NodeCanvas overlay */}

          {/* Main Header Row Container */}
          <div
            style={{
              height: 40,
              backgroundColor: '#716C6C',
              display: 'flex',
              alignItems: 'stretch',
              position: 'relative',
            }}
            onDoubleClick={handleHeaderDoubleClick} // Uncommented
          >
            {/* === Conditional Header Content === */}
            {side === 'left' ? (
              // --- Left Panel Header --- 
              <div style={{ flexGrow: 1, display: 'flex', justifyContent: 'flex-end', alignItems: 'stretch' }}>
                {/* All Things Button -> All Nodes */}
                {ENABLE_ALL_THINGS_TAB && (
                  <div
                    title="All Things"
                    style={{ /* Common Button Styles */ width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', backgroundColor: leftViewActive === 'all' ? '#bdb5b5' : '#979090', zIndex: 2 }}
                    onClick={() => setLeftViewActive('all')}
                  >
                    <LayoutGrid size={20} color="#260000" />
                  </div>
                )}
                {/* Library Button -> Saved Things */}
                <div
                  title="Saved Things"
                  style={{ /* Common Button Styles */ width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', backgroundColor: leftViewActive === 'library' ? '#bdb5b5' : '#979090', zIndex: 2 }}
                  onClick={() => setLeftViewActive('library')}
                >
                  <Bookmark size={20} color="#260000" />
                </div>
                {/* Grid Button -> Open Things */}
                <div
                  title="Open Things"
                  style={{ /* Common Button Styles */ width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', backgroundColor: leftViewActive === 'grid' ? '#bdb5b5' : '#979090', zIndex: 2 }}
                  onClick={() => setLeftViewActive('grid')}
                >
                  <BookOpen size={20} color="#260000" />
                </div>
                {/* Federation Button -> Solid Pods */}
                <div
                  title="Federation"
                  style={{ /* Common Button Styles */ width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', backgroundColor: leftViewActive === 'federation' ? '#bdb5b5' : '#979090', zIndex: 2 }}
                  onClick={() => setLeftViewActive('federation')}
                >
                  <Globe size={20} color="#260000" />
                </div>

                {/* Semantic Discovery Button */}
                <div
                  title="Semantic Discovery"
                  style={{ /* Common Button Styles */ width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', backgroundColor: leftViewActive === 'semantic' ? '#bdb5b5' : '#979090', zIndex: 2 }}
                  onClick={() => setLeftViewActive('semantic')}
                >
                  <TextSearch size={20} color="#260000" />
                </div>

                {/* AI Wizard Button */}
                <div
                  title="AI Wizard"
                  style={{ /* Common Button Styles */ width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', backgroundColor: leftViewActive === 'ai' ? '#bdb5b5' : '#979090', zIndex: 2 }}
                  onClick={() => setLeftViewActive('ai')}
                >
                  <Sparkles size={20} color="#260000" />
                </div>
              </div>
            ) : (
              // --- Right Panel Header (Uses store state `rightPanelTabs`) ---
              <>
                {/* Home Button (checks store state) */}
                {isExpanded && (() => {
                  const tabs = rightPanelTabs;
                  const isActive = tabs[0]?.isActive;
                  const bg = isActive ? '#bdb5b5' : '#979090';
                  return (
                    <div
                      title="Home"
                      key="home"
                      style={{
                        width: 40,
                        height: 40,
                        borderTopRightRadius: 0,
                        borderBottomLeftRadius: 0,
                        borderBottomRightRadius: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        backgroundColor: bg,
                        flexShrink: 0,
                        zIndex: 2
                      }}
                      onClick={() => activateRightPanelTab(0)}
                    >
                      <Info size={22} color="#260000" />
                    </div>
                  );
                })()}


                {/* Scrollable Tab Area (uses store state) */}
                {isExpanded && (
                  <div style={{ flex: '1 1 0', position: 'relative', height: '100%', minWidth: 0 }}>
                    <div
                      ref={(el) => {
                        tabBarRef.current = el;
                        tabDropZone(el);
                      }}
                      className="hide-scrollbar"
                      data-panel-tabs="true"
                      style={{
                        position: 'relative',
                        height: '100%',
                        display: 'flex',
                        alignItems: 'stretch',
                        paddingLeft: '8px',
                        paddingRight: '42px',
                        overflowX: 'auto',
                        overflowY: 'hidden',
                        backgroundColor: isNodeHoveringTabBar ? 'rgba(139, 0, 0, 0.1)' : 'transparent',
                        transition: 'background-color 0.2s ease'
                      }}
                    >
                      {/* Map ONLY node tabs (index > 0) - get tabs non-reactively */}
                      {rightPanelTabs.slice(1).map((tab, i) => { // Use different index variable like `i`
                        const nodeCurrentName = nodePrototypesMap.get(tab.nodeId)?.name || tab.title; // Get current name for display and drag
                        return (
                          <DraggableTab
                            key={tab.nodeId} // Use nodeId as key
                            tab={tab} // Pass tab data from store
                            index={i + 1} // Pass absolute index (1..N) based on map index `i`
                            displayTitle={nodeCurrentName} // Pass live name for display
                            dragItemTitle={nodeCurrentName} // Pass live name for drag item
                            moveTabAction={moveRightPanelTab}
                            activateTabAction={activateRightPanelTab}
                            closeTabAction={closeRightPanelTab}
                          />
                        );
                      })}
                      {/* Plus icon indicator when hovering */}
                      {isNodeHoveringTabBar && (
                        <div style={{
                          position: 'absolute',
                          right: '20px',
                          top: '50%',
                          transform: 'translateY(-50%)',
                          backgroundColor: '#8B0000',
                          color: '#EFE8E5',
                          borderRadius: '50%',
                          width: '24px',
                          height: '24px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '16px',
                          fontWeight: 'bold',
                          zIndex: 1000,
                          pointerEvents: 'none'
                        }}>
                          +
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
            {/* === End Conditional Header Content === */}
          </div>

          {/* Content Area */}
          <div
            className={`panel-content ${isScrolling ? 'scrolling' : ''} ${isHoveringScrollbar ? 'hovering-scrollbar' : ''}`}
            style={{ flex: 1, paddingBottom: effectiveBottomPadding, touchAction: 'pan-y' }}
            onScroll={() => {
              setIsScrolling(true);
              if (scrollTimeoutRef.current) {
                clearTimeout(scrollTimeoutRef.current);
              }
              scrollTimeoutRef.current = setTimeout(() => {
                setIsScrolling(false);
              }, 1500);
            }}
            onMouseEnter={handleScrollbarMouseEnter}
            onMouseMove={handleScrollbarMouseMove}
            onMouseLeave={handleScrollbarMouseLeave}
          >
            {panelContent}
          </div>
        </div>

        {/* Color Picker Component - Rendered in Portal to prevent clipping */}
        <PanelColorPickerPortal
          isVisible={colorPickerVisible}
          onClose={handleCloseColorPicker}
          onColorChange={handleColorChange}
          currentColor={colorPickerNodeId ? nodePrototypesMap.get(colorPickerNodeId)?.color || '#8B0000' : '#8B0000'}
          position={colorPickerPosition}
          direction="down-left"
        />



        {/* UnifiedSelector for type creation */}
        {typeNamePrompt.visible && (
          <UnifiedSelector
            mode="node-typing"
            isVisible={true}
            leftPanelExpanded={leftPanelExpanded}
            rightPanelExpanded={rightPanelExpanded}
            onClose={handleCloseTypePrompt}
            onSubmit={({ name, color }) => {
              const targetNodeId = typeNamePrompt.targetNodeId;
              if (name.trim() && targetNodeId) {
                // Create new type prototype
                const newTypeId = uuidv4();
                const newTypeData = {
                  id: newTypeId,
                  name: name.trim(),
                  description: '',
                  color: color || '#8B0000',
                  definitionGraphIds: [],
                  typeNodeId: null,
                };
                storeActions.addNodePrototype(newTypeData);
                storeActions.setNodeType(targetNodeId, newTypeId);
                console.log(`Created new type "${name.trim()}" and assigned to node ${targetNodeId}`);
              }
              handleCloseTypePrompt();
            }}
            onNodeSelect={(selectedPrototype) => {
              const targetNodeId = typeNamePrompt.targetNodeId;
              if (targetNodeId && selectedPrototype) {
                storeActions.setNodeType(targetNodeId, selectedPrototype.id);
                console.log(`Set type of node ${targetNodeId} to existing type: ${selectedPrototype.name}`);
              }
              handleCloseTypePrompt();
            }}
            initialName={typeNamePrompt.name}
            initialColor={typeNamePrompt.color}
            title="Name Your Thing"
            subtitle={`a more generic way to refer to ${typeNamePrompt.targetNodeName},<br/>also known as a superclass or a type.`}
            searchTerm={typeNamePrompt.name}
            showCreateNewOption={true}
          />
        )}

        {/* Merge Modal */}
        {showMergeModal && (
          <DuplicateManager
            onClose={() => setShowMergeModal(false)}
            nodePrototypes={nodePrototypes}
            storeActions={storeActions}
            instances={instances}
          />
        )}


      </>
    );
  }
), panelPropsAreEqual); // End of memo(forwardRef(...), customCompare)

export default Panel;
