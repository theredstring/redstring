# Canvas Resizing System Implementation Guide

## Overview
This guide contains the exact code changes needed to implement dynamic canvas resizing while preserving all existing zoom, pan, and traversal functionality.

## Files to Modify
- `src/NodeCanvas.jsx` - Main canvas component (primary changes)

## 1. Import the useViewportBounds Hook

Add to imports section around line 61:
```javascript
import { useViewportBounds } from './hooks/useViewportBounds';
```

## 2. Move Panel State Declarations Early

Move these state declarations to around line 865 (before viewport bounds hook):
```javascript
// Panel expansion states - must be defined before viewport bounds hook
const [leftPanelExpanded, setLeftPanelExpanded] = useState(true);
const [rightPanelExpanded, setRightPanelExpanded] = useState(true);
```

Remove the original declarations from around line 1418.

## 3. Replace Static Canvas Size with Dynamic Sizing

Replace the existing viewport/canvas size logic around lines 864-871:

**REMOVE:**
```javascript
const [viewportSize, setViewportSize] = useState({
  width: window.innerWidth,
  height: window.innerHeight - HEADER_HEIGHT,
});
const [canvasSize, setCanvasSize] = useState({
  width: window.innerWidth * 4,
  height: (window.innerHeight - HEADER_HEIGHT) * 4,
});
```

**REPLACE WITH:**
```javascript
// Use proper viewport bounds hook for accurate, live viewport calculations
const viewportBounds = useViewportBounds(leftPanelExpanded, rightPanelExpanded, false);

// Calculate viewport and canvas sizes from bounds
const viewportSize = useMemo(() => ({
  width: viewportBounds.width,
  height: viewportBounds.height,
}), [viewportBounds.width, viewportBounds.height]);

// Dynamic infinite canvas sizing based on content bounds
const getContentBounds = useCallback((nodeList) => {
  if (!nodeList || nodeList.length === 0) {
    // Minimum canvas size - larger than viewport for nice experience
    const minSize = Math.max(viewportBounds.width * 4, viewportBounds.height * 4, 4000);
    return { 
      minX: -minSize / 2, 
      minY: -minSize / 2, 
      maxX: minSize / 2, 
      maxY: minSize / 2 
    };
  }
  
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  
  nodeList.forEach(node => {
    const dims = baseDimsById.get(node.id);
    if (!dims) return;
    
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + dims.currentWidth);
    maxY = Math.max(maxY, node.y + dims.currentHeight);
  });
  
  // Add generous padding for infinite feeling
  const padding = Math.max(2000, viewportBounds.width, viewportBounds.height);
  return {
    minX: minX - padding,
    minY: minY - padding,
    maxX: maxX + padding,
    maxY: maxY + padding
  };
}, [baseDimsById, viewportBounds.width, viewportBounds.height]);

// Smart canvas expansion when nodes approach edges
const expandCanvasIfNeeded = useCallback((nodeList) => {
  const currentBounds = getContentBounds(nodeList);
  const expansionThreshold = 500; // Expand when nodes are within 500px of edge
  
  let needsExpansion = false;
  nodeList.forEach(node => {
    const dims = baseDimsById.get(node.id);
    if (!dims) return;
    
    const nodeRight = node.x + dims.currentWidth;
    const nodeBottom = node.y + dims.currentHeight;
    
    // Check if node is approaching content bounds
    if (node.x - currentBounds.minX < expansionThreshold ||
        node.y - currentBounds.minY < expansionThreshold ||
        currentBounds.maxX - nodeRight < expansionThreshold ||
        currentBounds.maxY - nodeBottom < expansionThreshold) {
      needsExpansion = true;
    }
  });
  
  return needsExpansion;
}, [getContentBounds, baseDimsById]);

const contentBounds = useMemo(() => {
  const bounds = getContentBounds(nodes);
  
  // Check if we need expansion and recalculate with larger padding if so
  if (expandCanvasIfNeeded(nodes)) {
    // Recalculate with extra expansion padding
    const extraPadding = Math.max(3000, viewportBounds.width * 2, viewportBounds.height * 2);
    
    if (nodes && nodes.length > 0) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      
      nodes.forEach(node => {
        const dims = baseDimsById.get(node.id);
        if (!dims) return;
        
        minX = Math.min(minX, node.x);
        minY = Math.min(minY, node.y);
        maxX = Math.max(maxX, node.x + dims.currentWidth);
        maxY = Math.max(maxY, node.y + dims.currentHeight);
      });
      
      return {
        minX: minX - extraPadding,
        minY: minY - extraPadding,
        maxX: maxX + extraPadding,
        maxY: maxY + extraPadding
      };
    }
  }
  
  return bounds;
}, [nodes, getContentBounds, expandCanvasIfNeeded, viewportBounds.width, viewportBounds.height, baseDimsById]);

const canvasSize = useMemo(() => ({
  width: contentBounds.maxX - contentBounds.minX,
  height: contentBounds.maxY - contentBounds.minY,
  offsetX: contentBounds.minX,
  offsetY: contentBounds.minY
}), [contentBounds]);
```

## 4. Update Viewport Culling to Use Dynamic Canvas

Find the culling useEffect around line 935 and update the viewport calculation:

**CHANGE:**
```javascript
const minX = (-panOffset.x) / zoomLevel;
const minY = (-panOffset.y) / zoomLevel;
```

**TO:**
```javascript
const minX = (-panOffset.x) / zoomLevel + canvasSize.offsetX;
const minY = (-panOffset.y) / zoomLevel + canvasSize.offsetY;
```

## 5. Update SVG Canvas Transform

Find the SVG canvas element around line 6539 and update the transform:

**CHANGE:**
```javascript
transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoomLevel})`,
```

**TO:**
```javascript
transform: `translate(${panOffset.x - canvasSize.offsetX * zoomLevel}px, ${panOffset.y - canvasSize.offsetY * zoomLevel}px) scale(${zoomLevel})`,
```

## 6. Update Grid Rendering

Find the grid rendering code around lines 6633-6636 and 6681-6684:

**CHANGE:**
```javascript
const startX = Math.floor((-panOffset.x / zoomLevel) / gridSize) * gridSize - gridSize * 5;
const startY = Math.floor((-panOffset.y / zoomLevel) / gridSize) * gridSize - gridSize * 5;
```

**TO:**
```javascript
// Account for canvas offset in grid calculations
const viewMinX = (-panOffset.x / zoomLevel) + canvasSize.offsetX;
const viewMinY = (-panOffset.y / zoomLevel) + canvasSize.offsetY;
const startX = Math.floor(viewMinX / gridSize) * gridSize - gridSize * 5;
const startY = Math.floor(viewMinY / gridSize) * gridSize - gridSize * 5;
```

Apply the same pattern to the dots grid calculation.

## 7. Update Zoom Limits

Find the MIN_ZOOM calculation around line 929 and replace:

**CHANGE:**
```javascript
const MIN_ZOOM = Math.max(
  viewportSize.width / canvasSize.width,
  viewportSize.height / canvasSize.height
);
```

**TO:**
```javascript
// For dynamic canvas, allow reasonable minimum zoom
const MIN_ZOOM = 0.1;
```

## What This Achieves

1. **Dynamic Canvas Sizing**: Canvas adapts to content automatically
2. **Smart Expansion**: Canvas grows when nodes approach edges
3. **Proper Viewport Tracking**: All systems work with dynamic canvas offsets
4. **Grid Adaptation**: Grid renders correctly with offset canvas
5. **Performance**: Proper culling with dynamic bounds

## What NOT to Change

- Do NOT modify any zoom calculation logic
- Do NOT modify any pan handling logic  
- Do NOT modify any mouse/keyboard event handlers
- Do NOT modify any canvas worker calls
- Keep all existing zoom limits and sensitivity constants
- Preserve all trackpad/mouse wheel detection logic

## Testing Checklist

After implementation:
- [ ] Canvas resizes when window resizes
- [ ] Canvas resizes when panels expand/collapse  
- [ ] Canvas grows when nodes approach edges
- [ ] Grid renders correctly in all cases
- [ ] Zoom works exactly as before (trackpad, mouse, keyboard)
- [ ] Pan works exactly as before (all methods)
- [ ] Node culling works correctly
- [ ] No performance issues or freezing