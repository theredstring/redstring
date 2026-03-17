import React, { useRef, useEffect, useMemo } from 'react';
import { useDrag, useDrop } from 'react-dnd';
import { getEmptyImage } from 'react-dnd-html5-backend';
import { XCircle } from 'lucide-react';
import { PANEL_CLOSE_ICON_SIZE } from '../../constants';
import { useTheme } from '../../hooks/useTheme.js';
import { getTextColor, hexToHsl, hslToHex } from '../../utils/colorUtils';

const ItemTypes = {
  TAB: 'tab'
};

const DraggableTab = ({ tab, index, displayTitle, dragItemTitle, moveTabAction, activateTabAction, closeTabAction, nodeColor }) => {
  const ref = useRef(null);
  const theme = useTheme();

  const [, drop] = useDrop({
    accept: ItemTypes.TAB,
    hover(item, monitor) {
      if (!ref.current) {
        return;
      }
      const dragIndex = item.index;
      const hoverIndex = index - 1;

      if (dragIndex === hoverIndex) {
        return;
      }

      const hoverBoundingRect = ref.current?.getBoundingClientRect();
      const hoverMiddleX = (hoverBoundingRect.right - hoverBoundingRect.left) / 2;
      const clientOffset = monitor.getClientOffset();
      const hoverClientX = clientOffset.x - hoverBoundingRect.left;

      if (dragIndex < hoverIndex && hoverClientX < hoverMiddleX) {
        return;
      }
      if (dragIndex > hoverIndex && hoverClientX > hoverMiddleX) {
        return;
      }

      moveTabAction(dragIndex, hoverIndex);
      item.index = hoverIndex;
    },
  });

  const [{ isDragging }, drag, preview] = useDrag({
    type: ItemTypes.TAB,
    item: () => ({
      id: tab.nodeId,
      index: index - 1,
      title: dragItemTitle,
      tab: tab
    }),
    collect: (monitor) => ({ isDragging: monitor.isDragging() }),
  });

  useEffect(() => {
    preview(getEmptyImage(), { captureDraggingState: true });
  }, [preview]);

  const opacity = isDragging ? 0.4 : 1;
  const cursorStyle = isDragging ? 'grabbing' : 'pointer';
  const isActive = tab.isActive;

  // Derive tab colors from the node's color
  const bg = useMemo(() => {
    if (!nodeColor) return isActive ? theme.canvas.bg : '#979090';
    const { h, s, l } = hexToHsl(nodeColor);
    // Active: use node color directly; inactive: desaturate to 35% and lighten
    return isActive
      ? nodeColor
      : hslToHex(h, Math.max(s * 0.35, 3), Math.min(l + 35, 85));
  }, [nodeColor, isActive, theme.canvas.bg]);

  const textColor = useMemo(() => {
    if (!nodeColor) return '#260000';
    return getTextColor(bg);
  }, [nodeColor, bg]);

  drag(drop(ref));

  return (
    <div
      ref={ref}
      className="panel-tab"
      style={{
        opacity,
        backgroundColor: bg,
        borderTopLeftRadius: '10px',
        borderTopRightRadius: '10px',
        borderBottomLeftRadius: 0,
        borderBottomRightRadius: 0,
        color: textColor,
        fontWeight: 'bold',
        fontSize: '0.9rem',
        fontFamily: "'EmOne', sans-serif",
        display: 'inline-flex',
        alignItems: 'center',
        padding: '0px 8px',
        marginRight: '6px',
        height: 'calc(100% - 3px)',
        marginTop: '3px',
        cursor: cursorStyle,
        maxWidth: '150px',
        minWidth: '60px',
        flexShrink: 0,
        transition: 'background-color 0.2s ease, color 0.2s ease, opacity 0.1s ease'
      }}
      onClick={() => activateTabAction(index)}
    >
      <span style={{
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        marginRight: '8px',
        userSelect: 'none'
      }}>
        {displayTitle}
      </span>
      <XCircle
        size={PANEL_CLOSE_ICON_SIZE}
        style={{
          marginLeft: 'auto',
          cursor: 'pointer',
          color: textColor,
          zIndex: 2,
          minWidth: `${PANEL_CLOSE_ICON_SIZE}px !important`,
          minHeight: `${PANEL_CLOSE_ICON_SIZE}px !important`,
          flexShrink: 0
        }}
        onClick={(e) => {
          e.stopPropagation();
          console.log('[DraggableTab Close Click] Tab object:', tab);
          closeTabAction(tab.nodeId);
        }}
      />
    </div>
  );
};

export default DraggableTab;
