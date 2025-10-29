<!-- fe0c9b2e-4251-4de5-9668-32442bd7189b 68d3cbb2-957a-489e-b3e0-5a88ebf255e8 -->
# Y-key Video Node Animation

## Implementation Approach

Create a separate `VideoNodeAnimation.jsx` component (similar to the existing `GhostSemanticNode` pattern) that plays independently and gets replaced by a real node when done. This keeps the special video logic isolated and easy to remove later.

## Key Files to Modify

### 1. Create `src/VideoNodeAnimation.jsx` (new file)

A standalone animation component with 4 phases:

- **Phase 1 (0-1s)**: Dot expands into horizontal line (full node width, minimal height)
- **Phase 2 (1-4s)**: Line "trembles" - oscillates height ±16.67% (1/6 of NODE_HEIGHT) using sine wave
- **Phase 3 (4-5s)**: Explodes to final node dimensions with text "Hello, World" fading in
- **Phase 4**: Calls `onComplete()` callback to spawn real node

Animation state:

```javascript
const phases = {
  stretch: { duration: 1000, startTime: 0 },
  tremble: { duration: 3000, startTime: 1000 },
  explode: { duration: 1000, startTime: 4000 }
};
```

Visual styling:

- Color: maroon (#800000) - default node color
- Stroke width: 5px to match node borders
- Corner radius: Start at 40 (pill-shaped), end at 40 (match node)

### 2. Modify `src/NodeCanvas.jsx`

In `handlePlusSignClick()` (line ~6073):

- Check if `keysPressed.current['y']` is true
- If yes:
  - Immediately remove plus sign: `setPlusSign(null)`
  - Store video animation state: `setVideoAnimation({ x: plusSign.x, y: plusSign.y, active: true })`
  - Skip normal prompt flow

Add state near other plus sign state (~line 2300):

```javascript
const [videoAnimation, setVideoAnimation] = useState(null);
```

Add completion handler:

```javascript
const handleVideoAnimationComplete = () => {
  if (!videoAnimation || !activeGraphId) return;
  
  // Calculate position (centered)
  const mockNode = { name: "Hello, World" };
  const dims = getNodeDimensions(mockNode, false, null);
  const position = {
    x: videoAnimation.x - dims.currentWidth / 2,
    y: videoAnimation.y - dims.currentHeight / 2
  };
  
  // Create node prototype and instance
  const newPrototypeId = uuidv4();
  storeActions.addNodePrototype({
    id: newPrototypeId,
    name: "Hello, World",
    description: '',
    color: 'maroon',
    definitionGraphIds: [],
    typeNodeId: 'base-thing-prototype'
  });
  storeActions.addNodeInstance(activeGraphId, newPrototypeId, position);
  
  setVideoAnimation(null);
};
```

In SVG render section (near line 11123 where PlusSign renders):

```javascript
{videoAnimation && videoAnimation.active && (
  <VideoNodeAnimation
    x={videoAnimation.x}
    y={videoAnimation.y}
    onComplete={handleVideoAnimationComplete}
  />
)}
```

### 3. Import in NodeCanvas

Add near line 66:

```javascript
import VideoNodeAnimation from './VideoNodeAnimation.jsx';
```

## Animation Technical Details

**Phase 1 - Stretch (1 second)**:

- Start: width=10, height=10 (dot)
- End: width=NODE_WIDTH, height=10 (line)
- Easing: easeInOut cubic

**Phase 2 - Tremble (3 seconds)**:

- Base height: 10px
- Oscillation: ±16.67px (NODE_HEIGHT / 6 ≈ 16.67)
- Frequency: ~6 cycles per second for frantic feel
- Formula: `height = 10 + 16.67 * Math.sin(elapsed * 6 * Math.PI * 2 / 1000)`

**Phase 3 - Explode (1 second)**:

- Start: width=NODE_WIDTH, height=10+oscillation
- End: width=NODE_WIDTH, height=NODE_HEIGHT
- Text "Hello, World" fades from opacity 0 to 1
- Easing: easeOut (fast start, slow finish for "explosion" feel)

## Session-Only Implementation

This is deliberately a standalone component that can be easily removed after the video. No changes to core animation logic in PlusSign or node creation flows.

### To-dos

- [ ] Create VideoNodeAnimation.jsx with 3-phase animation (stretch, tremble, explode)
- [ ] Modify handlePlusSignClick in NodeCanvas to detect 'y' key and trigger video animation
- [ ] Add videoAnimation state and completion handler to NodeCanvas
- [ ] Add VideoNodeAnimation component to NodeCanvas SVG rendering