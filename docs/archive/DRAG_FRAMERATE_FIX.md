# Drag Framerate Fix - RAF Throttling

## Problem

Node dragging appeared to be capped at a certain framerate and wasn't linked to the display refresh rate like other rendering operations (panning, edge animations, etc.).

## Root Cause

The drag update logic was wrapped in `requestAnimationFrame`, but it was called **on every `mousemove` event**:

```javascript
// BEFORE - Called on every mousemove
if (draggingNodeInfo) {
    requestAnimationFrame(() => {
        // Update node positions...
        storeActions.updateNodeInstance(...);
    });
}
```

This pattern doesn't actually throttle to the display refresh rate because:
1. Multiple `mousemove` events fire between frames (especially on high-polling-rate mice)
2. Each event schedules a **new RAF callback**
3. Multiple RAF callbacks execute in the **same frame**, causing redundant work
4. React state updates batch, but the calculations and state calls still happen multiple times

### Example Problem:
```
Frame 1: mousemove → RAF scheduled → executes position calc/update
         mousemove → RAF scheduled → executes position calc/update (redundant!)
         mousemove → RAF scheduled → executes position calc/update (redundant!)
Frame 2: ... (cycle repeats)
```

This causes **multiple position calculations per frame** but React batches the state updates, leading to wasted CPU cycles and inconsistent frame timing.

## Solution

Implement **proper RAF throttling** using a flag to ensure only **one RAF callback is scheduled at a time**:

### Implementation

**File:** `src/NodeCanvas.jsx` (lines 4854-4856, 5073-5206)

```javascript
// Add refs for RAF throttling
const pendingDragUpdate = useRef(null);
const dragUpdateScheduled = useRef(false);

const handleMouseMove = async (e) => {
    // ... other logic ...

    if (draggingNodeInfo) {
        // Store latest drag event for RAF processing
        pendingDragUpdate.current = { e, draggingNodeInfo };

        // Schedule RAF update ONLY if not already scheduled
        if (!dragUpdateScheduled.current) {
            dragUpdateScheduled.current = true;
            requestAnimationFrame(() => {
                dragUpdateScheduled.current = false;  // Reset flag
                const update = pendingDragUpdate.current;
                if (!update) return;

                const e = update.e;
                const draggingNodeInfo = update.draggingNodeInfo;

                // Perform position calculations and updates...
                // (group drag, multi-node drag, single node drag)
            });
        }
    }
};
```

### How It Works

```
Frame 1:
  mousemove #1 → pendingDragUpdate = event1, RAF scheduled, flag = true
  mousemove #2 → pendingDragUpdate = event2, RAF already scheduled (skipped)
  mousemove #3 → pendingDragUpdate = event3, RAF already scheduled (skipped)
  RAF executes → uses latest event (event3), flag = false

Frame 2:
  mousemove #4 → pendingDragUpdate = event4, RAF scheduled, flag = true
  RAF executes → uses latest event (event4), flag = false
```

**Result:** Exactly **one position calculation per frame**, always using the **latest mouse position**.

## Benefits

### 1. Matched to Display Refresh Rate
- 60Hz display → 60 updates/sec
- 120Hz display → 120 updates/sec
- 144Hz display → 144 updates/sec

Dragging now matches the smoothness of panning and other operations.

### 2. Reduced CPU Usage
- Before: 3-10 calculations per frame (depending on mouse polling rate)
- After: 1 calculation per frame
- **~70-90% reduction** in redundant calculations

### 3. Consistent Frame Timing
- No more multiple state updates within same frame
- Smoother visual updates
- Better perceived responsiveness

### 4. High Polling Rate Mouse Support
- 1000Hz mice no longer cause 1000 calculations/sec
- Throttles to display refresh rate automatically

## Performance Comparison

| Mouse Polling Rate | Display Hz | Before (updates/sec) | After (updates/sec) | Improvement |
|-------------------|------------|---------------------|---------------------|-------------|
| 125Hz             | 60Hz       | ~125                | 60                  | 52% reduction |
| 500Hz             | 60Hz       | ~500                | 60                  | 88% reduction |
| 1000Hz            | 60Hz       | ~1000               | 60                  | 94% reduction |
| 1000Hz            | 144Hz      | ~1000               | 144                 | 86% reduction |

## Edge Cases Handled

### 1. Multiple Rapid Mouse Moves
Only the **latest position** is used when the RAF executes, preventing stale data.

### 2. Drag End During Scheduled RAF
The `pendingDragUpdate.current` check ensures cleanup if dragging stops before RAF executes.

### 3. Fast Mouse Movement
Always uses the most recent position, so fast drags don't feel laggy.

## Comparison with Other Approaches

### Debouncing/Throttling
```javascript
// Time-based throttling - NOT IDEAL
const throttledUpdate = throttle(updatePosition, 16); // Fixed ~60fps
```
❌ Fixed to specific framerate (doesn't adapt to display)
❌ Can miss frames on high-refresh displays
❌ Can overshoot on low-refresh displays

### RAF-per-event (Original)
```javascript
// RAF on every event - NOT IDEAL
mousemove → requestAnimationFrame(update);
```
❌ Multiple RAF callbacks per frame
❌ Redundant calculations
❌ Inconsistent timing

### Proper RAF Throttling (New)
```javascript
// One RAF at a time - IDEAL ✅
if (!scheduled) {
    scheduled = true;
    requestAnimationFrame(update);
}
```
✅ Exactly one update per frame
✅ Adapts to display refresh rate
✅ Uses latest data
✅ Minimal CPU overhead

## Testing

### Visual Test
1. Enable a high-refresh display (120Hz+) if available
2. Drag a node in a circular motion
3. **Before:** Motion may appear choppy or inconsistent
4. **After:** Motion should be buttery smooth and match display refresh rate

### Performance Test
```javascript
// Add logging to verify
let frameCount = 0;
let startTime = performance.now();

requestAnimationFrame(() => {
    frameCount++;
    const elapsed = performance.now() - startTime;
    if (elapsed >= 1000) {
        console.log(`Drag updates/sec: ${frameCount}`);
        frameCount = 0;
        startTime = performance.now();
    }
});
```

**Expected result:** Update rate should match display refresh rate (60, 120, 144Hz, etc.)

### Console Verification
The existing console.log at line 5074 will show:
- **Before:** Multiple logs per frame
- **After:** One log per frame maximum

## Related Optimizations

This fix complements the existing save performance optimizations:
1. **Micro-batching middleware** - Batches state change notifications
2. **SaveCoordinator drag deferral** - Defers saves during drag via `isDragging: true`
3. **RAF throttling** (this fix) - Throttles position calculations to display refresh rate

Together, these ensure dragging is smooth and performant even with complex graphs.

## Additional RAF Optimizations

After the initial fix, additional operations were also throttled to display refresh rate:

### Connection Drawing (Lines 4858-4864, 5224-5236)
Connection line drawing while creating edges now uses RAF throttling:
```javascript
pendingConnectionUpdate.current = { currentX, currentY };
if (!connectionUpdateScheduled.current) {
    connectionUpdateScheduled.current = true;
    requestAnimationFrame(() => {
        setDrawingConnectionFrom(prev => prev && ({ ...prev, ... }));
    });
}
```

### Connection Label Clearing (Lines 4862-4884)
Label cache clearing during mouse movement now RAF-throttled:
```javascript
pendingLabelClear.current = e;
if (!labelClearScheduled.current) {
    labelClearScheduled.current = true;
    requestAnimationFrame(() => {
        clearLabelsOnMouseMove(pendingLabelClear.current);
    });
}
```

### Node-Group Visual Enhancements (Lines 7655-7670)
Added scale animation and drop shadow to node-groups during drag (matching Node.jsx behavior):
```javascript
const groupScale = isGroupDragging ? 1.05 : 1;
const groupTransform = isGroupDragging
  ? `translate(${centerX}, ${centerY}) scale(${groupScale}) translate(${-centerX}, ${-centerY})`
  : '';

<g style={{
  transform: groupTransform,
  transition: isGroupDragging ? 'none' : 'transform 0.2s ease-out',
  filter: isGroupDragging ? 'drop-shadow(0px 8px 16px rgba(0,0,0,0.3))' : 'none'
}}>
```

**Benefits:**
- Node-groups now "grow" to 105% scale when dragged
- Drop shadow adds depth and visual feedback
- Smooth scale-down transition when drag ends
- Matches the visual polish of individual nodes

## Files Modified

- **`src/NodeCanvas.jsx`**
  - Lines 4854-4864: Added RAF throttling refs for drag, connection, and labels
  - Lines 4874-4884: RAF-throttled label clearing
  - Lines 5073-5206: Implemented RAF throttling for drag updates
  - Lines 5224-5236: RAF-throttled connection drawing
  - Lines 7655-7670: Added scale animation and drop shadow to groups

## Build Status

✅ Build passes successfully (`npm run build` - 1.75s)

## Future Enhancements

1. **Adaptive frame skipping**: Skip frames if calculations take too long
2. **Web Worker offloading**: Move position calculations to worker thread
3. **Predictive positioning**: Interpolate between frames for ultra-smooth dragging
4. **Touch-specific throttling**: Different throttling for touch vs mouse input
