# NodeCanvas Region Map

This file tells you where things are in `src/NodeCanvas.jsx`, where each part is going, and which task moves it.

- **Pinned to @1e6ab02**, except rows marked deleted. After wave 1, NodeCanvas is 737 lines shorter, so every later line hint is roughly 20–900 lines too high. Line numbers are approximate and drift with every edit.
- **Find code by symbol.** Grep an anchor, e.g. `grep -n "const runCulling" src/NodeCanvas.jsx`, then read a window of at most 300 lines around the hit.
- **When you move a region**, replace its "Now" cell with the new location and the commit.

---

## Target structure

New modules follow the folders the repo already uses (D-11). Nothing below exists yet unless its row says so.

```
src/store/
  canvasUIStore.js          P2.01  shared UI state (the spine, F-47); NOT graphStore (D-04)
  viewportStore.js          P3.10  settled pan/zoom, visible node/edge sets
src/hooks/
  useStableSelector.js      P2.10  derived store values with an equality check (useActiveGraphNodes turned out unnecessary)
  useGroupLayouts.js        P3.03  group layout as pure data (no render-phase ref writes)
  useLabelPlacements.js     P3.05  deterministic whole-graph label pass
  useViewportCulling.js     P3.11
  useHoverIntent.js         P2.13
  useConnectionDraw.js      P4.03
  usePointerGestures.js     P4.04  pointer gesture state machine, stable handlers
  useStableCallback.js      P3.02
src/components/canvas/
  layers/  GridLayer, GroupLayer, EdgeLayer, ConnectionEdge, NodeLayer, OverlayLayer,
           DeletionGhostLayer, HurtleOrb                               P1.06, P2.07, P3
  pie/     buildNodePieMenuPages.js, buildEdgePieMenuButtons.js, pieMachine.js,
           NodePieMenuLayer.jsx, EdgePieMenuLayer.jsx                  P5
  hosts/   App-level hosts: ModalHosts, UniverseHost, SyncDebugHost, SearchHosts,
           PromptHosts, ColorPickerHost, WizardHost, ControlPanelHosts,
           PanelResizers                                               P2, P5
src/utils/canvas/
  viewportMath.js, canvasHitTest.js, edgeHitTest.js                    P4.01
  canvasCommands.js                                                    P2.08
  input/  inputTuning.js, CameraController.js, resolveCanvasTap.js     P4
src/utils/perf/renderProbe.js                                          P0.01
```

`src/NodeCanvas.jsx` stays where it is until P6. At the end it should contain only the `.canvas-area` orchestration.

---

## Module scope (before `function NodeCanvas()` at ~823)

| Region | Anchors | ~Lines | Destination | Task |
|---|---|---|---|---|
| Imports | — | 1–190 | shrinks as regions leave | — |
| Label, edge-hit and delete-ghost constants | `LABEL_ANGLE_QUANTUM`, `EDGE_HIT_FLOOR_PX_MOUSE`, `DELETE_GHOST_STAGGER_STEP_MS` | 193–450 | the layer or module that uses each one | P3 |
| Input tuning constants | `TOUCH_PINCH_SENSITIVITY`, `TRACKPAD_ZOOM_*`, `PAN_MOMENTUM_*`, `measureTrackpadZoomVelocity` | 462–689 | `utils/canvas/input/inputTuning.js` | P4.01 |
| Orbit constants | `ORBIT_SCRIM_COLOR`, `ORBIT_FIT_PADDING` | 689–790 | orbit module | P5.08 |
| Thumbnail helpers | `decodeThumbnail`, `waitForCachedImage` | 797–822 | node layer / imageCache | P3.08 |

## Component body

| Region | Anchors (grep these) | ~Lines | Destination | Task |
|---|---|---|---|---|
| Diagnostic flag (**deleted** d26dc7a), overlay group, gesture block | `setOverlayGroup`, `armGestureBlock`, `scheduleGestureBlockClear` | 823–940 | delete the flag; gesture block → gesture machine | P1.07, P4.04 |
| Orbit state | `orbitData`, `semanticOrbitActive`, `orbitFrame` | 906–919 | orbit module; the flag → UI store | P2.03, P5.08 |
| Store actions | `const storeActions` | 942 | stays (or import directly) | — |
| Panel widths + resizers | `leftPanelWidth`, `beginDrag`, `applyResizeUpdate`, `onDragMove`, `endDrag`, `renderPanelResizers` | 1013–1421 | `hosts/PanelResizers` | P1.05, P2.12 |
| Store subscriptions | `const activeGraphId = useGraphStore` … `hasUniverseFile` | 1426–1529 | narrowed to the active graph; shell-only ones leave with the shell | P3.01, P2 |
| Universe loading / onboarding / git reconnect | `loadingUniverseName`, `resolveGitReconnectTarget`, `openReconnect`, `retryUniverseLoad`, `openUniversesPanel`, `showStorageSetupModal` | 1537–1564, 2282–2786 | `hosts/UniverseHost` | P2.06c |
| hydratedNodes | `const hydratedNodes` | 1633 | canvas-internal (no longer a Panel prop since P2.09; TypeList reads the stores since P2.10) | P1.08, P3 |
| Header data | `headerGraphs`, `cleanupOrphanedGraphs` effect, `isFullscreen`, `toggleFullscreen`, `trackpadZoomEnabled` | 1757–1914 | **moved** to `hosts/HeaderHost` (P2.08); `trackpadZoomEnabled` → canvasUIStore. The orphan cleanup effect stays (data hygiene on `nodePrototypes`) | P2.08 |
| Core derived data | `const nodes = useMemo`, `const edges = useMemo`, `nodeById`, `baseDimsById`, `groupStructure`, mirror refs (`nodeByIdRef`, …) | 2005–2280 | stable identity, then selector hooks | P1.08, P3.01 |
| Selection + culling state | `selectedInstanceIds`, `visibleNodeIds`, `visibleEdges`, `showNodeHitboxes` | 2162–2175 | UI store / viewport store | P2.02, P3.11 |
| Clipboard version | `clipboardVersion`, `markClipboardChanged` | 2282 | UI store | P2.03 |
| Modal flags | — | — | **moved:** `hosts/ModalHosts` (P2.06b) | done |
| Connection drawing | `setDrawingConnectionFrom`, `applyDrawingConnection`, `setDrawingConnectionEnd`, `reprojectDrawingConnectionEnd`, `selfLoopPreviewActive`, `selfLoopDialog` | 2788–2933, 3381–3477 | `useConnectionDraw` | P4.03 |
| Pan-state wrappers | `const [isPanning`, `panStart`, `setIsPanning`, `setPanStart`, `selectionRect`, `selectionStart`, `recentlyPanned` | 2949–2987 | dead state removed; the rest → gesture machine | P1.01, P1.02, P4.04 |
| Viewport + transform wiring | `windowSize`, `viewportSize`, `canvasSize`, `const transform = useCanvasTransform`, `getBottomPanelReserve`, `getFramingRegion`, `runFramingAfterCommit` | 3019–3240 | camera controller | P4.02 |
| Dead position batching | `flushPositionUpdates`, `schedulePositionUpdate` | ~3243–3273 | **deleted** (ddbc5fe) | P1.02 |
| useNodeDrag wiring | `useNodeDrag(` and its 12 aliased return fields | 3288–3379 | fewer parameters | P4.08 |
| Grid snap, pan momentum, view motion | `snapToGridAnimated`, `stopPanMomentum`, `startPanMomentum`, `sampleViewMotion`, `isViewMoving`, `navigateToPrototypeInstances` | 3479–3700 | `CameraController` | P4.02 |
| Layout hook | `useGraphLayout(` | 3700 | stays; fewer parameters | P4 |
| Coordinates, zoom momentum, trackpad zoom | `clientToCanvasCoordinates`, `stopZoomMomentum`, `startZoomMomentum`, `stopTrackpadZoom`, `setTrackpadZoomTarget`, `endTrackpadZoomGesture`, `recordTrackpadZoomSample` | 3754–4290 | `CameraController`, `viewportMath` | P4.01, P4.02 |
| Culling | `const runCulling`, the culling effects | 4292–4830 | `useViewportCulling` + viewport store | P3.11 |
| Anchor flush (effect with no deps) | `anchorPositionUpdatesRef` flush | 4835–4869 | keyed on `useGroupLayouts` output | P3.03 |
| Edge geometry and label memos | `anchorGeometryFor`, `cleanLaneOffsets`, `lombardiTangents`, `edgeCurveInfo`, `labelCrossingIndex`, `labelObstacleOptions`, `labelAngleQuantum`, `quantizeLabelAngle`, `labelSpriteVersion`, `labelFontVersion`, `connectionNameSignature`, `selectedEdgeMidpoint`, `edgesByNodeId` | 4896–5545 | edge layer data hooks | P1.12, P3.05, P3.06 |
| Sync debug overlay | `debugMode`, `syncDebugData`, `buildSyncDebugData`, `recordSyncAction`, `handleRetrySyncEngine`, `handleForceSaveDebug`, `handleClearGitHubAppCache`, `handleDirectGitHubProbe`, `handleDumpAuthState` | 5558–6055 | `hosts/SyncDebugHost` | P2.06a |
| Canvas UI state block | `isPaused`, `isViewReady`, `plusSign`, `videoAnimation`, `nodeNamePrompt`, `connectionNamePrompt`, `abstractionPrompt`, `nodeGroupPrompt`, `newWebPrompt`, `openNewWebPrompt` | 6057–6097 | UI store / prompt hosts | P2.04, P5.06 |
| One-shot suggestions | `finalizeConnectionSuggestion`, `suggestEdgeArrowDirection`, `finalizeAbstractionSuggestion` | 6099–6271 | prompt hosts | P5.06 |
| Colour pickers | `dialogColorPickerVisible`, `pieMenuColorPickerVisible`, `edgeColorPickerVisible`, `handlePieMenuColorPicker*`, `handleEdgeColor*` | 6272–6276, 6505–6513, 8644–8737 | `hosts/ColorPickerHost` | P5.06 |
| Wizard | `askWizardPicker`, `wizardDestination`, `wizardEnabled`, `ensureWizardApiKey`, `openWizardAsk`, `openWizardWithPrompt`, `runWizardIntent`, `openWizardPicker` | 6280–6503 | `hosts/WizardHost`; `wizardEnabled` → UI store | P5.06 |
| Pie / edit UI state | `isHeaderEditing`, `isRight/LeftPanelInputFocused`, `isPieMenuRendered`, `currentPieMenuData`, `pieMenuPage`, `editingNodeIdOnCanvas`, `editingGroupId`, `tempGroupName` | 6532–6540 | UI store / pie machine | P2.03, P2.04, P5.02 |
| Edge hover, cache, painter, orbs | `hoveredEdgeInfo`, `connectionOrbHitsRef`, `edgeElementCacheRef`, `edgeSlotElsRef`, `registerEdgeSlot`, `findConnectionOrbAtPoint`, `toggleConnectionOrbArrow`, `tryToggleConnectionOrbAtPoint` | 6559–6731 | edge layer; cache and painter decided in P3.07 | P3.06, P3.07 |
| Hover dwell / vision aid | `hoveredNodeForVision`, `applyHoverCandidate`, `clearHoverImmediate`, `hoverStickyEdgeId`, `commitHoverTarget`, `clearVisionAid`, `handlePieMenuHoverChange` | 6733–6890 | `useHoverIntent` + hover slice | P2.13 |
| Pie target, deletion ghosts | `selectedNodeIdForPieMenu`, `isTransitioningPieMenu`, `deletionAnimations`, `captureDeletionGhosts`, `deleteNodeWithAnimation`, `deleteMultipleNodesWithAnimation` | 6895–6951 | UI store; `DeletionGhostLayer` | P2.03, P2.07 |
| Abstraction carousel | `abstractionCarouselVisible` … `carouselFocusedNode`, `animateCanvasView`, `carouselAnimationState`, `abstractionDimensions`, `onCarouselAnimationStateChange`, `onCarouselClose`, `requestCarouselClose`, `onCarouselReplaceNode`, `onCarouselExitAnimationComplete` | 6953–7400 | carousel host + pie machine | P5.02, P5.04 |
| Control-panel latches | `abstractionControlPanelVisible`, `nodeControlPanelVisible`, `groupControlPanelVisible`, `connectionControlPanelVisible`, `edgePieMenuVisible`, `selectedGroup`, `lastSelectedNodePrototypes`, `pendingSwapOperation` | 7163–7200 | control-panel hosts | P5.05 |
| Header search + more modal flags | `headerSearchVisible`, `headerAllThingsSearchVisible`, `autoGraphModalVisible`, `forceSimModalVisible`, `autoLayoutRunning` | 7201–7213 | `hosts/SearchHosts`, `ModalHosts` | P2.06 |
| Decompose preview + focus framing | `previewingNodeId`, `focusNodeInView`, `focusEdgePieMenuInView` | 7404–7742 | preview id → UI store; framing → camera | P2.03, P4.02 |
| Definition indices | `nodeDefinitionIndices` | 7744 | UI store | P2.03 |
| Graph-change cleanup + control-panel management | "Graph Change Cleanup", "… Control Panel Management" comments | 7755–7996 | pie machine / control-panel hosts | P5.02, P5.05 |
| Selection-derived data, group-panel actions | `selectedNodePrototypes`, `nodePrototypesForPanel`, `singleSelectedInstanceId`, `selectedGroupEffectiveColor`, `handleGroupPanel*`, `handleNodeConvertToNodeGroup` | 7997–8287 | control-panel hosts | P5.05 |
| Abstraction dimensions, bookmark | `handleAbstractionDimensionChange` … (bookmark **moved** to HeaderHost, P2.08) | 8288–8345 | carousel host | P5.04 |
| Shared gesture refs | `isMouseDown`, `mouseMoved`, `mouseDownPosition`, `startedOnNode`, `mouseInsideNode`, `longPressTimeout`, `ignoreCanvasClick`, `clickTimeoutIdRef`, `potentialClickNodeRef`, `isDoublePress` | 8345–8640 | gesture machine | P4.04 |
| Instance swap | `performInstanceSwap` | 8739 | prompt hosts | P5.06 |
| **Pie button builders** | `nodePieMenuPages`, `targetPieMenuButtons`, `decomposePanelInfo`, the pie→state sync effect (~9777) | 8784–9790 | pure builders | P1.10, P5.01 |
| View restore/save on graph switch | `storedView`, `jumpTo`, `updateGraphViewInStore` | 9790–9892 | `CameraController` | P4.02 |
| Pinch smoothing (**dead**) | `animatePinchSmoothing`, `startPinchSmoothing`, `stopPinchSmoothing` | 9894–10092 | **deleted** (ddbc5fe) | P1.02 |
| Hit-test utilities | `clampCoordinates`, `getNodeDescriptionContent`, `isInsideNode`, `selectionFromRect`, `findGroupTitleAtPoint`, `buildGroupDragOffsets`, `findConnectionDropTarget`, `isNearEdge` | 10094–10283 | `utils/canvas/canvasHitTest.js` | P4.01 |
| Edge hit-test and edge input | `handleEdgePointerDownTouch`, `findNearestEdgeAtCanvasPoint`, `getEdgeHitThreshold`, `findEdgeAtClientPoint`, `selectEdgeFromClick`, `resolveTouchEdgeTarget`, `beginEdgeTouch` / `moveEdgeTouch` / `cancelEdgeTouch` / `commitEdgeTouch`, `edgeTouchHandlers`, `trySelectConnectionAtPoint`, `getEdgeHitboxHandlers` | 10285–10786 | `utils/canvas/edgeHitTest.js`, stable handlers | P3.02, P4.01 |
| Node press | `const handleNodeMouseDown` | 10788–10907 | gesture machine | P4.04 |
| Wheel + Safari gestures | `const handleWheel` | 10916–11275 | `CameraController` | P4.02 |
| Touch hook wiring | `const touch = useCanvasTouch(` (73 parameters) | 11278–11352 | re-plumbed | P4.06 |
| Connection-draw finish, edge pan | (between the touch wiring and `handleMouseMove`) | 11385–11502 | `useConnectionDraw` | P4.03 |
| Mouse handlers | `async function handleMouseMove`, `async function handleMouseDown`, `async function handleMouseUp` | 11504–12300 | gesture machine (mechanics) + tap policy | P1.03, P1.04, P4.04, P4.05 |
| Canvas click policy | `const handleMouseUpCanvas`, `const handleCanvasClick` | 12301–12492 | `resolveCanvasTap` | P4.05 |
| Plus sign + prompts | `handlePlusSignClick`, `handleClosePrompt`, `handleAbstractionSubmit`, `handleNodeSelection`, `getPlusSignMorphNode`, `handleMorphDone`, `handleVideoAnimationComplete`, `handleDialogColorPicker*` | 12494–12935 | prompt hosts / plus-sign module | P5.06 |
| Prompt renderers (**dead**) | `renderConnectionNamePrompt`, `renderCustomPrompt` | 12943–13148 | **deleted** (ddbc5fe) | P1.02 |
| Panel toggles and focus | `shouldPanelsBeExclusive`, `handleToggleRightPanel`, `handleToggleLeftPanel`, `handleLeftPanelFocusChange` | 13150–13260 | App shell | P2.08–P2.12 |
| Gamepad glue | "Game controller" comment, the control refs, `useGamepad(` | 13260–13539 | `useGamepadBindings` | P4.07 |
| Keyboard hook | `useCanvasKeyboard(` (48 parameters) | 13541–13590 | stable listener, fewer parameters | P1.11, P4.09 |
| Canvas edit + project bio | `handleCommitCanvasEdit`, `handleProjectBioChange` (title **moved** to HeaderHost, P2.08) | 13602–13632 | node layer | P3.08 |
| Selection → pie/control-panel effects | effects at ~13690–13840 | 13690–13840 | pie machine | P5.02 |
| Semantic orbit | `updateOrbitDimRect`, `handleOrbitCandidateHover`, `exitOrbitMode`, `handleOrbitItemClick`, `activateSemanticOrbit` | 13840–14192, ~14650 | orbit module | P5.08 |
| Hurtle | `hurtleAnimation`, `runHurtleAnimation`, `getHeaderTabTarget`, `startHurtleAnimation`, `startHurtleAnimationFromPanel` | 14192–14417 | `layers/HurtleOrb` + command | P1.06 |
| Edge pie buttons | `const edgePieMenuButtons = useMemo` | 14431–14575 | pure builder | P5.01 |
| Node-panel and node-group actions | `handleNodePanelCopy`, `handleNodePanelDuplicate`, `useControlPanelActions(`, `handleNodeGroup*` | 14593–14852 | control-panel hosts / commands | P5.05 |
| Canvas commands + context menus | `triggerAutoLayout`, `snapToGrid`, `useCanvasCommands({`, `getCanvasContextMenuOptions`, `getContextMenuOptions` | 14853–15251 | commands registered (P2.08); `runActiveExport` → `services/universeFileActions.js`; menu builders | P5.07 |
| Back to civilization / clustering | `isInitialLoadComplete`, `nodesVisibleInStrictViewport` (dead), `clusterAnalysis`, `relevantNodesVisibleInStrictViewport`, `shouldShowBackToCivilization`, `handleBackToCivilizationClick` | 15262–15525 | leaf component on the viewport store | P3.10 |
| Misc (text width, …) | `getTextWidth` | 15525–15764 | — | — |

## JSX return (`return (` at ~15765)

| Region | Anchor | ~Lines | Destination | Task |
|---|---|---|---|---|
| Canvas root + overlay portal | `placeOverlays(`, `className="canvas-area"` | 15765–16005 | **moved:** the shell is `hosts/CanvasShell` (P2.11); overlays portal into its slot until their hosts land | P2.06, P5 |
| Left Panel | — | — | **moved:** `hosts/PanelHost`, rendered by CanvasShell | done |
| `.canvas-area` div + its handlers | `className="canvas-area"` | 16026–16052 | stays | — |
| Loading / error / empty states | `isUniverseLoading ?` | 16053–16256 | `UniverseHost` | P2.06c |
| `<svg>` + content group | `<g ref={contentGroupRef}>` | 16258–16274 | stays | — |
| Cluster hulls (debug), grid | `showClusterHulls`, `gridActive` | 16275–16362 | `GridLayer` | P3.09 |
| **Groups IIFE** | "Groups Phase 1" comment | 16363–17066 | `useGroupLayouts` + `GroupLayer` | P3.03, P3.04 |
| Node hitbox debug | `showNodeHitboxes && hydratedNodes` | 17067–17091 | overlay (debug) | P3.09 |
| **Edges IIFE** | `isViewReady && (() =>`, `const edgeRenderCtx`, `renderEdgeCached` | 17092–17355 | `EdgeLayer` / `ConnectionEdge` | P1.07, P3.06 |
| Connection-draw line, self-loop preview | `drawingConnectionFrom && !draggingNodeInfo` | 17356–17397 | `OverlayLayer` | P3.09 |
| **Nodes + pie menus IIFE** | `const renderNodeElement`, `<PieMenu`, `onExitAnimationComplete={() =>` | 17398–18051 | `NodeLayer`; pie layers | P3.08, P5.03 |
| Selection rect, PlusSign, VideoNodeAnimation | `selectionRect &&`, `<PlusSign`, `<VideoNodeAnimation` | 18052–18112 | `OverlayLayer` | P1.04, P3.09 |
| Orbit scrim/overlay svg, HoverVisionAid, GamepadCrosshair | `semanticOrbitActive &&`, `<HoverVisionAid`, `<GamepadCrosshair` | 18113–18184 | orbit module; hover slice | P5.08, P2.13 |
| EdgeGlowIndicator, BackToCivilization, DownloadAppPill, resizers | `edgeGlowMode !== 'off'`, `<BackToCivilization`, `renderPanelResizers()` | 18185–18233 | leaves on the viewport store; `PanelResizers` | P3.10, P2.12 |
| Header searches, New Web prompt, prompts IIFE | `headerSearchVisible &&`, `newWebPrompt.visible &&` | 18234–18544 | `SearchHosts`, `PromptHosts` | P2.06d, P5.06 |
| Hurtle orb | `hurtleAnimation &&` | 18545–18562 | `HurtleOrb` | P1.06 |
| Right Panel | — | — | **moved:** `hosts/PanelHost`, rendered by CanvasShell | done |
| SaveStatusDisplay | `<SaveStatusDisplay` | 18586–18596 | TypeList **moved** (`hosts/TypeListHost` in CanvasShell); SaveStatusDisplay → UniverseHost | P2.06c |
| Control panels, carousel, colour pickers | `<NodeControlPanel`, `<UnifiedBottomControlPanel`, `<ConnectionControlPanel`, `<AbstractionControlPanel`, `<AbstractionCarousel`, `<ColorPicker` | 18597–18845 | P5 hosts | P5.04–P5.06 |
| GitReconnect, StorageSetup, confirm dialogs, WizardIntentModal, self-loop dialog | `<GitReconnectModal`, `<StorageSetupModal`, `<CanvasConfirmDialog`, `<WizardIntentModal` | 18847–19088 | `UniverseHost`, `PromptHosts`, `WizardHost` | P2.06c, P5.06 |
| AutoGraph, ForceSim, Help, Settings, Merge, DebugOverlay, LayoutProgress | `<AutoGraphModal` … `<LayoutProgressIndicator` | 19089–19250 | `ModalHosts`, `SyncDebugHost` | P2.06a, P2.06b, P2.06f |

---

## Modules already outside NodeCanvas (from earlier efforts)

| Module | Lines | State |
|---|---|---|
| `src/hooks/useCanvasTransform.js` | 360 | Real win (refs + settle). It will publish settle to the viewport store in P3.10 |
| `src/hooks/useNodeDrag.js` | 3,133 | Per-frame work bypasses the DOM (good). 42 parameters, so it's a seam |
| `src/hooks/useCanvasTouch.js` | 1,710 | Adapter onto the mouse path; 73 parameters (F-42) |
| `src/hooks/useCanvasKeyboard.js` | 808 | Latest-props ref (good); its listener re-subscribes every render (F-14) |
| `src/hooks/useGamepad.js` | — | Control-object pattern: the template to copy (F-41) |
| `src/hooks/useGraphLayout.js` | 914 | 32 parameters |
| `src/components/canvas/renderConnectionEdge.jsx` | 1,985 | Plain function, not a component (F-23) |
| `src/utils/canvas/*` | ~5,500 | Pure geometry and labels, well tested |
