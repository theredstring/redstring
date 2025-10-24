# Refactoring Plan: `src/NodeCanvas.jsx`

## 1. Problem Statement

The `src/NodeCanvas.jsx` component has grown significantly, becoming a "god component" responsible for a vast array of functionalities including:
*   Canvas interaction (pan, zoom, node dragging, selection, connection drawing).
*   Extensive local UI state management for various overlays, prompts, and control panels.
*   Complex data derivation and memoization (nodes, edges, culling, routing paths).
*   Integration with the Zustand store for global state.
*   Management of numerous UI sub-components.

This monolithic structure leads to:
*   **Poor Readability:** Difficult to understand the component's overall flow and specific functionalities.
*   **High Maintenance Cost:** Changes in one area can have unintended side effects elsewhere.
*   **Reduced Testability:** Hard to unit test specific behaviors in isolation.
*   **Potential Performance Bottlenecks:** Complex re-render logic.
*   **Lack of Reusability:** Logic is tightly coupled to this single component.

## 2. Goal

To break down `src/NodeCanvas.jsx` into smaller, more focused, and maintainable units using React custom hooks and dedicated components, thereby improving code organization, readability, testability, and reusability.

## 3. Refactoring Strategy

The core strategy involves extracting cohesive units of functionality into:
*   **Custom Hooks:** For reusable logic and state management that doesn't directly render UI.
*   **Smaller Components:** For distinct UI elements and their associated rendering logic.

### 3.1. Proposed Custom Hooks

These hooks will encapsulate specific logic and state, returning data and functions to the parent `NodeCanvas` component.

*   **`useCanvasInteraction`**:
    *   **Responsibilities:** Pan, zoom, node dragging, selection box, connection drawing, long press, click/double-click detection, and all associated mouse/touch event handlers.
    *   **Returns:** `panOffset`, `zoomLevel`, `selectedInstanceIds`, `draggingNodeInfo`, `drawingConnectionFrom`, and event handlers to attach to the canvas.
*   **`useGraphData`**:
    *   **Responsibilities:** Deriving and memoizing `nodes`, `edges`, `nodeById`, `baseDimsById`, and handling viewport culling (`visibleNodeIds`, `visibleEdges`).
    *   **Inputs:** `activeGraphId`, `graphsMap`, `nodePrototypesMap`, `edgesMap`, `panOffset`, `zoomLevel`, `viewportSize`, `canvasSize`.
*   **`useNodeRouting`**:
    *   **Responsibilities:** Generating complex edge paths (Manhattan, Clean routing, `cleanLaneOffsets`).
    *   **Inputs:** Routing settings (`enableAutoRouting`, `routingStyle`, `manhattanBends`, `cleanLaneSpacing`) and graph data (`nodes`, `edges`, `nodeById`, `baseDimsById`).
*   **`usePanelResizing`**:
    *   **Responsibilities:** Managing state (`leftPanelWidth`, `rightPanelWidth`, `isDraggingLeft`, `isDraggingRight`) and logic (`beginDrag`, `onDragMove`, `endDrag`) for the left and right panel resizers, including global event listeners.
*   **`useGlobalPreventZoom`**:
    *   **Responsibilities:** Encapsulating the `useEffect` that prevents browser page zoom.
*   **`useUniverseLoader`**:
    *   **Responsibilities:** Handling the `useEffect` for `tryUniverseRestore` and the initial graph creation logic.
*   **`useGraphCleanup`**:
    *   **Responsibilities:** Encapsulating the `useEffect` that clears UI state when the `activeGraphId` changes.
*   **`usePieMenuState`**:
    *   **Responsibilities:** Managing the state related to the Pie Menu's visibility, data, and stage transitions.
*   **`useAbstractionCarouselState`**:
    *   **Responsibilities:** Managing the state and callbacks for the Abstraction Carousel.
*   **`useControlPanelVisibility`**:
    *   **Responsibilities:** Managing the visibility state for the Connection and Abstraction control panels.

### 3.2. Proposed Smaller Components

These components will be responsible for rendering specific UI elements, receiving data and callbacks via props.

*   **`CanvasBackground`**: Renders the SVG background, grid, and main SVG element.
*   **`NodeRenderer`**: Iterates over `visibleNodeIds` and renders individual `Node` components.
*   **`EdgeRenderer`**: Iterates over `visibleEdges` and renders the SVG paths for edges.
*   **`SelectionBox`**: Renders the visual selection rectangle.
*   **`ConnectionDrawingOverlay`**: Renders the temporary line when drawing a new connection.
*   **`PanelResizerHandles`**: Renders the visual resizer bars and attaches interaction handlers.
*   **`NodeNamePrompt`**, **`ConnectionNamePrompt`**, **`AbstractionPrompt`**: Dedicated components for each prompt.
*   **`NodeColorPicker`**: A reusable component for color selection.
*   **`NodeSelectionGridOverlay`**: Renders the `NodeSelectionGrid` component.
*   **`PlusSignOverlay`**: Renders the `PlusSign` component.
*   **`PieMenuContainer`**: Renders the `PieMenu` component.
*   **`AbstractionCarouselContainer`**: Renders the `AbstractionCarousel` component.
*   **`ConnectionControlPanelContainer`**: Renders the `ConnectionControlPanel`.
*   **`AbstractionControlPanelContainer`**: Renders the `AbstractionControlPanel`.

## 4. Benefits of this Refactoring

*   **Improved Readability:** Each file will have a single, clear responsibility.
*   **Easier Maintenance:** Changes are localized, reducing the risk of unintended side effects.
*   **Enhanced Testability:** Smaller, more focused units are easier to unit test in isolation.
*   **Better Performance (Potentially):** More granular components and hooks can lead to more efficient re-renders.
*   **Increased Reusability:** Extracted hooks and components can be reused elsewhere.
*   **Clearer Separation of Concerns:** UI, logic, and data management are distinctly separated.

## 5. High-Level Implementation Steps

1.  **Create New Files:** Establish a logical directory structure (e.g., `src/hooks`, `src/components/canvas`, `src/components/overlays`).
2.  **Move Code Incrementally:** Refactor one logical unit (hook or component) at a time.
3.  **Identify Inputs/Outputs:** Clearly define the props/arguments and return values for each extracted unit.
4.  **Update Imports:** Adjust import paths in `NodeCanvas.jsx` and the new files.
5.  **Test Thoroughly:** After each incremental step, verify functionality through existing tests and manual testing.

## 6. Dependency Management in Other Files

Refactoring `NodeCanvas.jsx` will significantly alter the project's import graph. Careful management of dependencies is crucial to avoid circular dependencies, overly complex import chains, and maintain a clean architecture.

### 6.1. New Directory Structure

*   **`src/hooks/`**: For all custom hooks (e.g., `useCanvasInteraction.js`, `useGraphData.js`).
*   **`src/components/canvas/`**: For components directly related to the canvas rendering (e.g., `CanvasBackground.jsx`, `NodeRenderer.jsx`, `EdgeRenderer.jsx`).
*   **`src/components/overlays/`**: For UI elements that appear as overlays (e.g., `NodeNamePrompt.jsx`, `PieMenuContainer.jsx`, `AbstractionCarouselContainer.jsx`).
*   **`src/components/panels/`**: For control panels (e.g., `ConnectionControlPanelContainer.jsx`, `AbstractionControlPanelContainer.jsx`).
*   **`src/utils/`**: Existing utilities like `getNodeDimensions` should remain here.
*   **`src/constants.js`**: Should remain a central place for constants.
*   **`src/store/graphStore.jsx`**: The Zustand store should remain foundational.

### 6.2. Import Paths

*   **From `NodeCanvas.jsx`:** Imports will change from local files (e.g., `./Node.jsx`) to new, more specific paths (e.g., `../components/canvas/NodeRenderer.jsx`, `../hooks/useCanvasInteraction.js`).
*   **Within New Files:** New components and hooks will import from each other or from shared utilities/store. For example, `NodeRenderer.jsx` might import `Node.jsx` (if `Node` remains a separate component) and `useGraphStore` selectors.

### 6.3. Avoiding Circular Dependencies

*   **Directional Flow:** Establish a clear dependency flow. Generally:
    *   **Hooks should not import Components:** Hooks provide logic and state; components consume them. If a hook needs to trigger a UI action (e.g., open a prompt), it should expose a callback function that the parent component (`NodeCanvas`) can then use to update its state or render the appropriate component.
    *   **Components can import Hooks:** Components will consume the logic and state provided by hooks.
    *   **Core Utilities/Store:** Files like `src/utils.js`, `src/constants.js`, and `src/store/graphStore.jsx` are foundational and can be imported by almost any hook or component without causing circular dependencies, as they don't import from the UI layer.
*   **Callback-Based Communication:** Instead of hooks directly manipulating UI state or rendering components, they should return functions or state that the consuming component (`NodeCanvas`) can use to manage its own rendering. For example, `useCanvasInteraction` might return `setSelectionRect`, and `NodeCanvas` would then use this setter to update the `selectionRect` state, which in turn triggers the `SelectionBox` component to render.
*   **Props for Data and Callbacks:** Components should be as "dumb" as possible, receiving all necessary data and callbacks via props. This makes them highly reusable and testable.
*   **Zustand Store Access:**
    *   **`NodeCanvas.jsx`:** Will continue to be the primary orchestrator, accessing many store actions and passing them down as props to relevant child components or hooks.
    *   **Custom Hooks:** Can directly use `useGraphStore` selectors and actions (e.g., `const updateNodePrototype = useGraphStore((state) => state.updateNodePrototype);`) as needed, as hooks are part of the logic layer.
    *   **Smaller Components:** If a component needs to read or write to the store, it can either receive the necessary data/actions via props from `NodeCanvas`, or directly use `useGraphStore` selectors/actions if it's a self-contained unit that doesn't need its store interactions managed by its parent. Prefer passing props for actions that affect the parent's rendering or other sibling components.

### 6.4. Global Event Listeners

*   Global event listeners (e.g., for preventing page zoom) should be encapsulated within their dedicated custom hooks (`useGlobalPreventZoom`). This ensures they are properly added and removed when the hook is mounted/unmounted, preventing memory leaks and conflicts.

By following these guidelines, the refactoring process will result in a more modular, understandable, and maintainable codebase.
