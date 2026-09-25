/**
 * The canvas and node right-click menus (P5.07), moved verbatim from
 * NodeCanvas's callbacks. NodeCanvas passes the render values each one closes
 * over as `ctx`, with the same callback dependencies, so every action sees what
 * it saw before.
 */
import { Activity, ArrowUpFromDot, Bookmark, ClipboardPaste, Combine, Edit3, Grid3x3, Layers, LayoutGrid, Merge, Orbit, PackageOpen, Palette, RefreshCw, Sparkles, Trash2 } from 'lucide-react';
import { SURFACES as WIZARD_SURFACES } from '../../../wizard/prompts/intents.js';
import { clientToCanvas } from '../../../utils/canvas/viewportMath.js';
import { getNodeDimensions } from '../../../utils.js';
import { pasteClipboard } from '../../../utils/clipboard.js';
import useGraphStore from '../../../store/graphStore.js';
import { webFacts } from '../../../wizard/prompts/facts.js';

export function buildCanvasContextMenuOptions(clientX, clientY, ctx) {
  const {
    activeGraphId, canvasSize, clipboardRef, condenseGraphNodes, containerRef, graphsMap,
    openWizardPicker, panOffsetRef, setForceSimModalVisible, setSelectedInstanceIds, snapToGrid, storeActions,
    triggerAutoLayout, wizardEnabled, zoomLevelRef,
  } = ctx;
  const options = [
    {
      label: 'Auto Layout Web',
      icon: <LayoutGrid size={14} />,
      action: () => {
        triggerAutoLayout();
      }
    },
    {
      label: 'Snap to Grid',
      icon: <Grid3x3 size={14} />,
      action: () => {
        snapToGrid();
      }
    },
    // Third, above the layout verbs: the wizard is the thing you reach for
    // most on this menu, so it sits where the hand already is rather than
    // below a list you have to read past.
    ...(wizardEnabled ? [{
      label: 'Ask The Wizard',
      icon: <Sparkles size={14} />,
      action: () => {
        const st = useGraphStore.getState();
        if (!st.activeGraphId || !st.graphs.get(st.activeGraphId)) return;
        const facts = webFacts();
        openWizardPicker(WIZARD_SURFACES.WEB, {}, {
          facts,
          subjectLabel: `"${facts.webName}"`
        });
      }
    }] : []),
    // The merge modal is mounted here in NodeCanvas, but go through the same
    // event the other entry points use so there is one opener.
    {
      label: 'Merge Duplicates',
      icon: <Merge size={14} />,
      action: () => {
        window.dispatchEvent(new Event('openMergeModal'));
      }
    },
    // The rest of what the Redstring menu's View section held. They are verbs
    // on the web in front of you, which is what this menu is for and what a
    // File-menu flyout never was — and unlike that flyout, this surface is
    // reachable by touch and already walked by the game controller.
    {
      label: 'Condense Things',
      icon: <Combine size={14} />,
      action: () => {
        condenseGraphNodes();
      }
    },
    {
      label: 'Force Simulation',
      icon: <Activity size={14} />,
      action: () => {
        setForceSimModalVisible(true);
      }
    },
    // Last, and the only one here that is not about the web: a plain reload.
    // It was the Redstring menu's File → Refresh, and below the width where
    // that menu stands down there is otherwise no way to ask for one without
    // a keyboard.
    {
      label: 'Refresh',
      icon: <RefreshCw size={14} />,
      action: () => {
        window.location.reload();
      }
    }
  ];

  // Paste — only when the clipboard holds Redstring-ready node content and
  // there's an active graph to drop it into. The label reflects the shape of
  // what was copied (connections between selected nodes are captured on copy):
  //   1 node                              → Paste Thing
  //   many nodes, no connections          → Paste Things
  //   exactly 2 nodes + 1 directed edge   → Paste Triplet
  //   many nodes + any connections        → Paste Web
  const clip = clipboardRef.current;
  if (activeGraphId && Array.isArray(clip?.nodes) && clip.nodes.length > 0) {
    const nodeCount = clip.nodes.length;
    const edges = Array.isArray(clip.edges) ? clip.edges : [];
    const edgeCount = edges.length;

    // A triplet is strictly subject → connection → object: exactly 2 nodes,
    // exactly 1 connection between them, pointing exactly one way.
    // Everything else with connections is a Web. Specifically NOT a triplet:
    //   - more than 2 nodes
    //   - undirected connection (0 arrows)
    //   - doubly-connected / bidirectional (2 arrows)
    const soleEdgeArrows = edgeCount === 1
      ? edges[0]?.edgeData?.directionality?.arrowsToward
      : null;
    const arrowCount = soleEdgeArrows instanceof Set
      ? soleEdgeArrows.size
      : (Array.isArray(soleEdgeArrows) ? soleEdgeArrows.length : 0);
    const isTriplet = nodeCount === 2 && edgeCount === 1 && arrowCount === 1;

    let pasteLabel;
    if (edgeCount === 0) {
      pasteLabel = nodeCount === 1 ? 'Paste Thing' : 'Paste Things';
    } else if (isTriplet) {
      pasteLabel = 'Paste Triplet';
    } else {
      pasteLabel = 'Paste Web';
    }

    options.push({
      label: pasteLabel,
      icon: <ClipboardPaste size={14} />,
      action: () => {
        const currentGraph = graphsMap.get(activeGraphId);
        if (!currentGraph) return;

        // Convert the right-click screen point to canvas coords (mirrors the
        // Cmd/Ctrl+V handler in useCanvasKeyboard.js).
        // Measure the container, not the <svg>: during a zoom gesture the svg
        // rides a CSS transform on the gesture layer (see useCanvasTransform)
        // while panOffsetRef/zoomLevelRef stay in the untransformed frame, so
        // mixing the two would disagree. .canvas-area never transforms.
        const rect = containerRef.current?.getBoundingClientRect();
        let targetPos;
        if (rect && typeof clientX === 'number' && typeof clientY === 'number') {
          targetPos = clientToCanvas(clientX, clientY, rect, panOffsetRef.current, zoomLevelRef.current, canvasSize);
        } else {
          targetPos = {
            x: clip.originalCenter.x + 50,
            y: clip.originalCenter.y + 50
          };
        }

        const result = pasteClipboard(
          clip,
          activeGraphId,
          targetPos,
          storeActions,
          currentGraph,
          getNodeDimensions
        );
        if (result?.newInstanceIds) {
          setSelectedInstanceIds(new Set(result.newInstanceIds));
        }
      }
    });
  }
  return options;
}

export function buildNodeContextMenuOptions(instanceId, ctx) {
  const {
    abstractionCarouselVisible, activeGraphId, canvasSize, carouselAnimationState, containerRef, deleteNodeWithAnimation,
    handlePieMenuColorPickerOpen, nodes, panOffsetRef, previewingNodeId, rightPanelExpanded, savedNodeIds,
    setAbstractionCarouselNode, setAbstractionCarouselVisible, setCarouselAnimationState, setEditingNodeIdOnCanvas, setNodeControlPanelVisible, setSelectedInstanceIds,
    setSelectedNodeIdForPieMenu, setSemanticOrbitActive, startHurtleAnimation, storeActions, targetPieMenuButtons, zoomLevelRef,
  } = ctx;
  const node = nodes.find(n => n.id === instanceId);
  if (!node) return [];

  // Clockwise order starting from top center: Open Web, Decompose, Generalize/Specify, Delete, Edit, Save, Color
  return [
    // Open Web (expand-tab) - core functionality from PieMenu expand action
    {
      label: 'Open Web',
      icon: <ArrowUpFromDot size={14} />,
      action: () => {
        const nodeData = nodes.find(n => n.id === instanceId);
        if (!nodeData) return;
        const prototypeId = nodeData.prototypeId;
        const currentState = useGraphStore.getState();
        const proto = currentState.nodePrototypes.get(prototypeId);
        if (proto?.definitionGraphIds && proto.definitionGraphIds.length > 0) {
          const targetGraphId = proto.definitionGraphIds[0];
          startHurtleAnimation(instanceId, targetGraphId, prototypeId);
        } else {
          const sourceGraphId = activeGraphId;
          storeActions.createAndAssignGraphDefinitionWithoutActivation(prototypeId);
          setTimeout(() => {
            const refreshed = useGraphStore.getState().nodePrototypes.get(prototypeId);
            if (refreshed?.definitionGraphIds?.length > 0) {
              const newGraphId = refreshed.definitionGraphIds[refreshed.definitionGraphIds.length - 1];
              startHurtleAnimation(instanceId, newGraphId, prototypeId, sourceGraphId);
            } else {

            }
          }, 50);
        }
      }
    },
    // Decompose - open pie menu and auto-trigger decompose
    {
      label: 'Decompose',
      icon: <PackageOpen size={14} />,
      action: () => {
        if (!abstractionCarouselVisible && carouselAnimationState === 'exiting') {

          return;
        }

        // Open the pie menu for this node
        setSelectedInstanceIds(new Set([instanceId]));
        setSelectedNodeIdForPieMenu(instanceId);

        // After pie menu appears, auto-trigger the decompose button
        setTimeout(() => {
          const decomposeButton = targetPieMenuButtons.find(btn => btn.id === 'decompose-preview');
          if (decomposeButton && decomposeButton.action) {

            decomposeButton.action(instanceId);
          }
        }, 100); // Small delay to let pie menu appear first
      }
    },
    // Generalize/Specify (abstraction) - directly open carousel without pie menu animation
    {
      label: 'Generalize / Specify',
      icon: <Layers size={14} />,
      action: () => {
        if (!abstractionCarouselVisible && carouselAnimationState === 'exiting') {

          return;
        }
        // Directly set up abstraction carousel like onExitAnimationComplete does

        const nodeData = nodes.find(n => n.id === instanceId);
        if (nodeData) {
          setAbstractionCarouselNode(nodeData);
          setCarouselAnimationState('entering');
          setAbstractionCarouselVisible(true);
          setSelectedNodeIdForPieMenu(instanceId);
          setSelectedInstanceIds(new Set([instanceId]));
        }
      }
    },
    // Delete - same as PieMenu
    {
      label: 'Delete',
      icon: <Trash2 size={14} />,
      action: () => {
        deleteNodeWithAnimation(instanceId);
        setSelectedInstanceIds(new Set());
        setSelectedNodeIdForPieMenu(null);
      }
    },
    // Edit - same as PieMenu  
    {
      label: 'Edit',
      icon: <Edit3 size={14} />,
      action: () => {
        const instance = nodes.find(n => n.id === instanceId);
        if (instance) {
          storeActions.openRightPanelNodeTab(instance.prototypeId, instance.name);
          if (!rightPanelExpanded) {
            storeActions.setRightPanelExpanded(true);
          }
          setEditingNodeIdOnCanvas(instanceId);
        }
      }
    },
    // Save - same as PieMenu
    {
      label: (() => {
        const node = nodes.find(n => n.id === instanceId);
        return node && savedNodeIds.has(node.prototypeId) ? 'Unsave' : 'Save';
      })(),
      icon: <Bookmark size={14} fill={(() => {
        const node = nodes.find(n => n.id === instanceId);
        return node && savedNodeIds.has(node.prototypeId) ? 'maroon' : 'none';
      })()} />,
      action: () => {
        const node = nodes.find(n => n.id === instanceId);
        if (node) {
          storeActions.toggleSavedNode(node.prototypeId);
        }
      }
    },
    // Color - needs to ensure node is selected for color picker context
    {
      label: 'Color',
      icon: <Palette size={14} />,
      action: () => {
        const node = nodes.find(n => n.id === instanceId);
        if (node) {
          // Ensure node is selected for color picker context
          setSelectedNodeIdForPieMenu(instanceId);
          setSelectedInstanceIds(new Set([instanceId]));

          // Small delay to ensure selection is set, then open color picker
          setTimeout(() => {
            // Calculate screen coordinates like the PieMenu does
            const dimensions = getNodeDimensions(node, previewingNodeId === node.id, null);
            const nodeCenter = {
              x: node.x + dimensions.currentWidth / 2,
              y: node.y + dimensions.currentHeight / 2
            };
            // Canvas→client is the container rect plus the live pan/zoom, the
            // exact inverse of the client→canvas math the input handlers use.
            // (This previously measured the <svg> and dropped the offsetX/Y
            // term, putting the anchor 50000*zoom px away; and the <svg> now
            // carries a CSS transform during zoom gestures, so the container
            // is also the only rect that stays in the refs' frame.)
            const canvasRect = containerRef.current?.getBoundingClientRect();
            const zNow = zoomLevelRef.current;
            const panNow = panOffsetRef.current;
            const screenX = (canvasRect?.left || 0) + (nodeCenter.x * zNow + (panNow.x - canvasSize.offsetX * zNow));
            const screenY = (canvasRect?.top || 0) + (nodeCenter.y * zNow + (panNow.y - canvasSize.offsetY * zNow));

            // Use this as anchor for color picker
            handlePieMenuColorPickerOpen(instanceId, { x: screenX, y: screenY });
          }, 50);
        }
      }
    },
    // Semantic Orbit
    {
      label: 'Semantic Orbit',
      icon: <Orbit size={14} />,
      action: () => {
        setSemanticOrbitActive(true);
        setSelectedNodeIdForPieMenu(null);
        setNodeControlPanelVisible(false);
        // Ensure the node is the only one selected for orbit focus
        setSelectedInstanceIds(new Set([instanceId]));
      }
    }
  ];
}
