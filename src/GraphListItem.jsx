import React, { useState, useCallback, useMemo, useEffect, useRef, useDeferredValue, forwardRef } from 'react';
import { RENDERER_PRESETS } from './UniversalNodeRenderer.presets';
import { useTheme } from './hooks/useTheme.js';
import { NODE_HEIGHT } from './constants'; // Assuming we use this height
import WebCard, { useWebCardCornerRadius } from './components/webPreview/WebCard.jsx';
import { XCircle } from 'lucide-react'; // <<< Import XCircle
import { useDrag } from 'react-dnd';
import { haptic } from './services/haptics.js';
import { getEmptyImage } from 'react-dnd-html5-backend';
import useGraphStore from './store/graphStore.js';
import useDoubleTap from './hooks/useDoubleTap.js';
// import './GraphListItem.css'; // We'll create this later

const SPAWNABLE_NODE = 'spawnable_node';
const ACTIVE_BORDER = 12;

const GraphListItem = forwardRef(({
  graphData,
  panelWidth,
  isActive,
  onClick,
  onDoubleClick,
  onClose, // <<< Add onClose prop
  onContextMenu,
  // False for a card far out of the list's view (LeftGridView): it keeps its
  // frame but not its web, so the DOM and the memory stay bounded by what is
  // near the screen, however many webs are open.
  drawWeb = true,
}, ref) => {
  const theme = useTheme();
  // The following line seems to be out of context as 'node' is not defined in this component.
  // However, as per instructions, it is added faithfully. It might cause a runtime error.
  // const Icon = RENDERER_PRESETS[node.prototypeId]?.icon || Circle;
  const [isHovered, setIsHovered] = useState(false);
  const nodePrototypes = useGraphStore(state => state.nodePrototypes);

  // Get the defining node's name for fallback matching
  const definingNodeName = useMemo(() => {
    const definingNodeId = graphData.definingNodeIds?.[0];
    if (definingNodeId) {
      const definingNode = nodePrototypes.get(definingNodeId);
      return definingNode?.name;
    }
    return null;
  }, [graphData.definingNodeIds, nodePrototypes]);

  const [{ isDragging }, drag, preview] = useDrag(() => ({
    type: SPAWNABLE_NODE,
    item: {
      prototypeId: graphData.definingNodeIds?.[0],
      nodeName: definingNodeName, // Include node name for fallback matching
      // The web this row is, as a header tab's drag carries it: dropped back on
      // this list or the header strip it reorders; on the canvas it spawns.
      graphId: graphData.id
    },
    canDrag: () => {
      const canDrag = !!graphData.definingNodeIds?.[0];
      // console.log('[GraphListItem] canDrag check for', graphData.name, 'definingNodeId:', graphData.definingNodeIds?.[0], 'canDrag:', canDrag);
      return canDrag;
    },
    collect: (monitor) => ({
      isDragging: !!monitor.isDragging(),
    }),
  }), [graphData.id, graphData.definingNodeIds, definingNodeName]);

  useEffect(() => {
    preview(getEmptyImage(), { captureDraggingState: true });
  }, [preview]);

  // Double-click (or double-tap): open this web in the right panel.
  const handleDoubleClick = useCallback(() => {
    onDoubleClick?.(graphData.id);
  }, [graphData.id, onDoubleClick]);
  const doubleTap = useDoubleTap(handleDoubleClick);

  const handleClick = useCallback(() => {
    // Matches HeaderGraphTab: only a real switch gets a haptic.
    if (!isActive) haptic('graphSwitch');
    onClick?.(graphData.id);
  }, [onClick, graphData.id, isActive]);

  const handleMouseEnter = useCallback(() => setIsHovered(true), []);
  const handleMouseLeave = useCallback(() => setIsHovered(false), []);

  // Before the first measure, roughly the row's width (the list's 5px right padding).
  const fallbackWidth = panelWidth ? panelWidth - 5 : NODE_HEIGHT;

  // The row IS the web's card (WebCard, as a definition shows in the right
  // panel): the card sets its height, and the row's corners stay concentric
  // with the card's frame, inside the active row's border too.
  const rowRef = useRef(null);
  const border = isActive ? ACTIVE_BORDER : 0;
  const cardSizingName = definingNodeName || graphData.name;
  const radius = useWebCardCornerRadius(rowRef, cardSizingName, { border, fallbackWidth });

  // The web on show can be the one being dragged on the canvas; let the
  // canvas frame win, as the right panel's card does.
  const nodes = useDeferredValue(graphData.nodes);
  const edges = useDeferredValue(graphData.edges);
  const groups = useDeferredValue(graphData.groups);

  const itemStyle = useMemo(() => ({
    width: '100%',
    backgroundColor: graphData.color || 'maroon',
    margin: '5px 0',
    borderRadius: `${radius}px`,
    boxSizing: 'border-box',
    cursor: 'pointer',
    border: isActive ? `${ACTIVE_BORDER}px solid black` : 'none',
    transition: 'border 0.2s ease, border-radius 0.2s ease',
    position: 'relative',
    opacity: isDragging ? 0.5 : 1,
  }), [radius, graphData.color, isActive, isDragging]);

  return (
    <div
      ref={(node) => {
        drag(node);
        rowRef.current = node;
        if (typeof ref === 'function') {
          ref(node);
        } else if (ref) {
          ref.current = node;
        }
      }}
      style={itemStyle}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      {...doubleTap}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onContextMenu={onContextMenu ? (e) => onContextMenu(e, graphData.id) : undefined}
      title={graphData.name} // Tooltip with full name
      data-nav="item"
      data-graph-id={graphData.id}
    >
      <WebCard
        nodes={nodes}
        edges={edges}
        groups={groups}
        title={graphData.name}
        sizingName={cardSizingName}
        color={graphData.color}
        drawWeb={drawWeb}
      />

      {/* Add Close Button Conditionally */}
      {isActive && (
        <XCircle
          size={24}
          style={{
            position: 'absolute',
            top: '0px',
            right: '0px',
            transform: 'translate(40%, -40%)',
            cursor: 'pointer',
            color: theme.canvas.bg,

            backgroundColor: 'black',
            borderRadius: '50%',
            padding: '6px',
            zIndex: 2
          }}
          onClick={(e) => {
            e.stopPropagation(); // Prevent triggering item onClick
            onClose?.(graphData.id); // Call onClose prop with graph ID
          }}
          onMouseEnter={(e) => e.currentTarget.style.color = '#EFE8E5'}
          onMouseLeave={(e) => e.currentTarget.style.color = theme.canvas.bg}

          title="Close Tab"
        />
      )}


    </div>
  );
});

GraphListItem.displayName = 'GraphListItem';

const areGraphListItemPropsEqual = (prevProps, nextProps) => (
  prevProps.graphData === nextProps.graphData &&
  prevProps.panelWidth === nextProps.panelWidth &&
  prevProps.isActive === nextProps.isActive &&
  prevProps.drawWeb === nextProps.drawWeb &&
  prevProps.onClick === nextProps.onClick &&
  prevProps.onClose === nextProps.onClose &&
  prevProps.onDoubleClick === nextProps.onDoubleClick &&
  prevProps.onContextMenu === nextProps.onContextMenu
);

export default React.memo(GraphListItem, areGraphListItemPropsEqual);