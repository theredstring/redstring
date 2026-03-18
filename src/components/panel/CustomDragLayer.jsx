import React from 'react';

import { useDragLayer } from 'react-dnd';
import { useTheme } from '../../hooks/useTheme.js';
import UniversalNodeRenderer from '../../UniversalNodeRenderer';

const ItemTypes = {
  TAB: 'tab'
};

// Custom Drag Layer - Component to render the preview during tab drag
const CustomDragLayer = () => {
  const theme = useTheme();
  const { itemType, isDragging, item, initialOffset, currentOffset } = useDragLayer(
    (monitor) => ({
      item: monitor.getItem(),
      itemType: monitor.getItemType(),
      initialOffset: monitor.getInitialSourceClientOffset(),
      currentOffset: monitor.getSourceClientOffset(),
      isDragging: monitor.isDragging(),
    })
  );

  if (!isDragging || itemType !== ItemTypes.TAB || !initialOffset || !currentOffset) {
    return null;
  }

  // Get the tab data from the item
  const { tab } = item; // Assuming tab data is passed in item

  // Style for the layer element
  const layerStyles = {
    position: 'fixed',
    pointerEvents: 'none',
    zIndex: 1, // Lower z-index to be below buttons (which are zIndex: 2)
    left: 0,
    top: 0,
    width: '100%',
    height: '100%',
  };

  // Function to calculate clamped transform
  const getItemStyles = (initialOffset, currentOffset, tabBarRef) => {
    if (!initialOffset || !currentOffset) {
      return { display: 'none' };
    }

    let clampedX = currentOffset.x;
    // tabBarRef is no longer passed, so this clamping logic needs to be re-evaluated or removed if not needed.
    // For now, removing the clamping logic that depends on tabBarRef.
    // const tabBarBounds = tabBarRef.current?.getBoundingClientRect();

    // if (tabBarBounds) {
    //   // Clamp the x position within the tab bar bounds
    //   clampedX = Math.max(
    //     tabBarBounds.left,
    //     Math.min(currentOffset.x, tabBarBounds.right - 150) // Adjust right bound by approx tab width
    //   );
    // }

    // Use clamped X for horizontal, initial Y for vertical
    const transform = `translate(${clampedX}px, ${initialOffset.y}px)`;
    return {
      transform,
      WebkitTransform: transform,
    };
  }

  // Style the preview element itself (similar to the original tab)
  const previewStyles = {
    backgroundColor: theme.canvas.bg, // Active tab color for preview
    borderTopLeftRadius: '10px',
    borderTopRightRadius: '10px',
    color: theme.canvas.textPrimary,
    fontWeight: 'bold',
    fontSize: '0.9rem',
    display: 'inline-flex',
    alignItems: 'center',
    padding: '0px 8px',
    height: '40px', // Match tab height
    maxWidth: '150px',
    // boxShadow: '0 4px 8px rgba(0,0,0,0.3)', // Removed shadow
    opacity: 0.9, // Slightly transparent
  };

  return (
    <div style={layerStyles}>
      <div style={{ ...previewStyles, ...getItemStyles(initialOffset, currentOffset) }}>
         {/* Simplified content for preview */}
        <span style={{
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          borderRadius: '8px',
          backgroundColor: theme.canvas.bg,
          border: `2px solid ${item.node.color || theme.canvas.textPrimary}`,
          marginRight: '8px',
          userSelect: 'none'
        }}>
          {item.title} {/* Use title from item */}
        </span>
        {/* No close button in preview */}
      </div>
    </div>
  );
};

export default CustomDragLayer;
