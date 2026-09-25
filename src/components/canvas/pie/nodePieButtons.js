/**
 * The node pie menu's button sets (P5.01), moved verbatim from NodeCanvas's
 * memos. NodeCanvas passes the render values each set closes over as `ctx` and
 * memoizes on the same dependencies, so every action sees what it saw before.
 * Pie and carousel lifecycle changes go through the pie machine
 * (`dispatchPie`, P5.02b step 5) rather than setters captured in `ctx`.
 */
import { ArrowLeft, ArrowUpFromDot, Bookmark, ChevronLeft, ChevronRight, ClipboardCopy, CopyPlus, CornerDownLeft, CornerUpLeft, Edit3, ImagePlus, Layers, NotebookText, Orbit, Package, PackageOpen, Palette, Plus, Scaling, SendToBack, Sparkles, TextSearch, Trash2 } from 'lucide-react';
import { THUMBNAIL_MAX_DIMENSION, nextNodeSizeStep, nodeSizeLabel } from '../../../constants';
import { copySelection } from '../../../utils/clipboard.js';
import { generateThumbnail, loadImageFileAsDataUrl } from '../../../utils.js';
import { getActionHoverItem } from '../../../utils/canvas/actionHover.js';
import { getPrototypeIdFromItem } from '../../../utils/abstraction.js';
import { resolveChain } from '../../../wizard/tools/utils/abstractionSpec.js';
import useGraphStore from '../../../store/graphStore.js';
import useImageCache from '../../../services/imageCache.js';
import useCanvasUIStore from '../../../store/canvasUIStore.js';
import { v4 as uuidv4 } from 'uuid';
import { togglePieMenuColorPicker } from '../colorPickers/colorPickers.js';

const dispatchPie = (event, env) => useCanvasUIStore.getState().dispatchPie(event, env);

export function buildNodePieMenuPages(ctx) {
  const {
    activeGraphId, clipboardRef, deleteNodeWithAnimation, markClipboardChanged,
    nodes, savedNodeIds, selectedNodeIdForPieMenu, setActivePieMenuItemForVision, setEditingNodeIdOnCanvas,
    setNodeControlPanelVisible, setSwapPrompt, singleSelectedInstanceId, startHurtleAnimation, storeActions,
    wizardEnabled,
  } = ctx;
  const primaryPage = [
    {
      id: 'expand-tab',
      label: 'Expand',
      icon: ArrowUpFromDot,
      action: (instanceId) => {
        const nodeData = nodes.find(n => n.id === instanceId);
        if (nodeData) {
          const prototypeId = nodeData.prototypeId;
          const currentState = useGraphStore.getState();
          const prototypeData = currentState.nodePrototypes.get(prototypeId);

          if (prototypeData?.definitionGraphIds && prototypeData.definitionGraphIds.length > 0) {
            // Node has definitions - start hurtle animation to first one
            const graphIdToOpen = prototypeData.definitionGraphIds[0];
            startHurtleAnimation(instanceId, graphIdToOpen, prototypeId);
          } else {
            // No definitions recorded. Self-heal: find any existing graph that defines this prototype
            const sourceGraphId = activeGraphId;
            let orphanGraphId = null;
            try {
              for (const [gId, g] of currentState.graphs.entries()) {
                if (Array.isArray(g.definingNodeIds) && g.definingNodeIds.includes(prototypeId)) {
                  orphanGraphId = gId;
                  break;
                }
              }
            } catch (_) { }

            if (orphanGraphId) {
              console.log('[Expand] Found orphan definition graph. Repairing and opening.', {
                prototypeId,
                orphanGraphId
              });
              // Self-heal: add to prototype.definitionGraphIds
              storeActions.updateNodePrototype(prototypeId, draft => {
                draft.definitionGraphIds = Array.isArray(draft.definitionGraphIds) ? draft.definitionGraphIds : [];
                if (!draft.definitionGraphIds.includes(orphanGraphId)) {
                  draft.definitionGraphIds.push(orphanGraphId);
                }
              });
              startHurtleAnimation(instanceId, orphanGraphId, prototypeId, sourceGraphId);
            } else {
              // No existing definition anywhere - create one
              storeActions.createAndAssignGraphDefinitionWithoutActivation(prototypeId);

              setTimeout(() => {
                const updatedState = useGraphStore.getState();
                const updatedNodeData = updatedState.nodePrototypes.get(prototypeId);
                if (updatedNodeData?.definitionGraphIds?.length > 0) {
                  const newGraphId = updatedNodeData.definitionGraphIds[updatedNodeData.definitionGraphIds.length - 1];
                  startHurtleAnimation(instanceId, newGraphId, prototypeId, sourceGraphId);
                }
              }, 50);
            }
          }
        }
      }
    },
    {
      id: 'decompose-preview',
      label: 'Decompose',
      icon: PackageOpen,
      action: (instanceId) => {
        // The menu shrinks; the preview opens when it has (PIE_TO_DECOMPOSE; the
        // machine ignores it while a carousel is exiting).
        dispatchPie({ type: 'PIE_TO_DECOMPOSE', nodeId: instanceId });
      }
    },
    {
      id: 'abstraction', label: 'Abstraction', icon: Layers, action: (instanceId) => {
        // The menu shrinks; the carousel opens when it has (PIE_TO_CAROUSEL; the
        // machine ignores it while a carousel is exiting).
        dispatchPie({ type: 'PIE_TO_CAROUSEL', nodeId: instanceId });
      }
    },
    {
      id: 'delete', label: 'Delete', icon: Trash2, action: (instanceId) => {
        deleteNodeWithAnimation(instanceId);
        dispatchPie({ type: 'PIE_TARGET', id: null, selection: [] });
      }
    },
    {
      id: 'edit', label: 'Edit', icon: Edit3, action: (instanceId) => {
        const instance = nodes.find(n => n.id === instanceId);
        if (instance) {
          // Open panel tab using the PROTOTYPE ID
          storeActions.openRightPanelNodeTab(instance.prototypeId, instance.name);
          // Ensure right panel is expanded (read now: the menu may predate a toggle)
          if (!useGraphStore.getState().rightPanelExpanded) {
            storeActions.setRightPanelExpanded(true);
          }
          // Enable inline editing on canvas using the INSTANCE ID
          setEditingNodeIdOnCanvas(instanceId);
        }
      }
    },
    {
      id: 'save',
      label: (() => {
        const node = nodes.find(n => n.id === selectedNodeIdForPieMenu);
        return node && savedNodeIds.has(node.prototypeId) ? 'Unsave' : 'Save';
      })(),
      icon: Bookmark,
      fill: (() => {
        const node = nodes.find(n => n.id === selectedNodeIdForPieMenu);
        return node && savedNodeIds.has(node.prototypeId) ? 'maroon' : 'none';
      })(),
      action: (instanceId) => {
        const node = nodes.find(n => n.id === instanceId);
        if (node) {
          storeActions.toggleSavedNode(node.prototypeId);
        }
      }
    },
    {
      id: 'palette', label: 'Palette', icon: Palette, action: (instanceId, buttonPosition) => {
        const node = nodes.find(n => n.id === instanceId);
        if (node && buttonPosition) {
          // Use the actual button position passed from PieMenu
          togglePieMenuColorPicker(instanceId, buttonPosition);
        }
      }
    },
    {
      id: 'open-in-panel', label: 'Open in Panel', icon: NotebookText, action: (instanceId) => {
        const instance = nodes.find(n => n.id === instanceId);
        if (!instance) return;
        storeActions.openRightPanelNodeTab(instance.prototypeId, instance.name);
        if (!useGraphStore.getState().rightPanelExpanded) storeActions.setRightPanelExpanded(true);
      }
    }
  ];

  // Reached via the ▶ chevron. Change Size cycles the per-instance size (stored
  // in instance.scale) through the discrete steps M → L → XL → XS → S → M,
  // layering on top of the global node-size scope.
  const secondaryPage = [
    {
      id: 'duplicate', label: 'Duplicate', icon: CopyPlus, action: (instanceId) => {
        const instance = nodes.find(n => n.id === instanceId);
        if (!instance || !activeGraphId) return;
        // Drop the copy slightly down-right of the original so it's visibly distinct.
        const offset = 40;
        const newInstanceId = uuidv4();
        storeActions.addNodeInstance(
          activeGraphId,
          instance.prototypeId,
          { x: instance.x + offset, y: instance.y + offset },
          newInstanceId
        );
        // Move selection (and the pie menu) to the new copy.
        dispatchPie({ type: 'PIE_TARGET', id: newInstanceId, selection: [newInstanceId] });
      }
    },
    {
      id: 'copy', label: 'Copy', icon: ClipboardCopy, action: (instanceId) => {
        // Copy this node (and any edges among the selection) to the clipboard,
        // same path as Ctrl/Cmd+C so it can be pasted anywhere.
        const st = useGraphStore.getState(); // at click time, so the menu needn't track the maps
        const currentGraph = st.graphs.get(activeGraphId);
        if (!currentGraph || !instanceId) return;
        const copied = copySelection(new Set([instanceId]), currentGraph, st.nodePrototypes, st.edges);
        if (copied) {
          clipboardRef.current = copied;
          markClipboardChanged();
        }
      }
    },
    {
      id: 'swap', label: 'Swap', icon: SendToBack, action: (instanceId) => {
        // Open the unified selector: pick an existing Thing or make a new one to
        // re-point this instance at, keeping all connections (see performInstanceSwap).
        const instance = nodes.find(n => n.id === instanceId);
        setSwapPrompt({ visible: true, instanceId, name: '', color: instance?.color ?? null });
      }
    },
    {
      id: 'add-image', label: 'Add Image', icon: ImagePlus, action: (instanceId) => {
        // Mirrors the panel's Add Image: pick a file, store it (full + thumbnail)
        // on the node's prototype as data URLs. User uploads persist in-file.
        const instance = nodes.find(n => n.id === instanceId);
        const prototypeId = instance?.prototypeId;
        if (!prototypeId) return;
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        // Mobile Safari (and some mobile browsers) only open the file
        // picker when the input is in the DOM. Attach it off-screen and
        // remove it once a file is chosen or the picker is dismissed.
        input.style.position = 'fixed';
        input.style.left = '-9999px';
        input.style.opacity = '0';
        document.body.appendChild(input);
        const cleanup = () => { try { input.remove(); } catch { } };
        input.onchange = async (e) => {
          const file = e.target.files?.[0];
          cleanup();
          if (!file) return;
          const cache = useImageCache.getState();
          cache.startImageLoading(prototypeId); // shimmer placeholder while decoding
          try {
            // HEIC-aware read (tablet/phone cameras default to HEIC, which
            // browsers can't decode natively) — see loadImageFileAsDataUrl.
            const { dataUrl, width, height } = await loadImageFileAsDataUrl(file);
            const aspectRatio = (width > 0 && height > 0) ? (height / width) : 1;
            const thumbSrc = await generateThumbnail(dataUrl, THUMBNAIL_MAX_DIMENSION);
            storeActions.updateNodePrototype(prototypeId, draft => {
              // imageRef cleared: it addresses the PREVIOUS image, and leaving
              // it would have the panel resolve the old picture from the repo.
              Object.assign(draft, { imageSrc: dataUrl, thumbnailSrc: thumbSrc, imageAspectRatio: aspectRatio, imageRef: null, imageRefExt: null });
              // User image replaces any auto-enriched Wikipedia thumbnail — clear
              // the flag so the save system persists it in-file.
              if (draft.semanticMetadata?.autoEnriched) {
                draft.semanticMetadata = { ...draft.semanticMetadata, autoEnriched: false, wikipediaThumbnail: null };
              }
              // Not recorded — a base64 data URL in both patch and inverse.
            }, { type: 'prototype_image' });
          } catch (error) {
            console.error('[PieMenu] Add Image failed:', error);
            alert(error?.message || 'Could not add this image.');
          } finally {
            cache.stopImageLoading(prototypeId);
          }
        };
        // Cancelled picker fires no onchange; clean up on next focus.
        window.addEventListener('focus', () => setTimeout(cleanup, 300), { once: true });
        input.click();
      }
    },
    {
      id: 'semantic-search', label: 'Semantic Search', icon: TextSearch, action: (instanceId) => {
        // Mirrors the right panel's Text Search: open Semantic Discovery for this
        // node's name (and trigger the search directly if the view is already up).
        const instance = nodes.find(n => n.id === instanceId);
        const query = instance?.name || '';
        if (!query.trim()) return;
        try {
          window.dispatchEvent(new CustomEvent('openSemanticDiscovery', { detail: { query } }));
          if (typeof window.triggerSemanticSearch === 'function') {
            window.triggerSemanticSearch(query);
          }
        } catch { }
      }
    },
    // Gated like every other Ask The Wizard entry point. This one and the
    // carousel's were the two that were not, so turning the wizard off left two
    // buttons behind that opened it anyway.
    ...(wizardEnabled ? [{
      id: 'ask-wizard', label: 'Ask The Wizard', icon: Sparkles, action: (instanceId) => {
        const instance = nodes.find(n => n.id === instanceId);
        if (!instance) return;
        window.dispatchEvent(new CustomEvent('rs-ask-wizard-define-node', {
          detail: { prototypeId: instance.prototypeId }
        }));
      }
    }] : []),
    {
      id: 'orbit', label: 'Semantic Orbit', icon: Orbit, action: (instanceId) => {
        dispatchPie({ type: 'ORBIT', active: true });
        // Deliberately NOT clearing selectedNodeIdForPieMenu: the menu is
        // hidden for the duration by the semanticOrbitActive check on its
        // isVisible prop instead. Clearing the target would unmount the
        // menu and trip the "reset to page 0 when the target changes"
        // effect, so leaving orbit would bring it back on the wrong page —
        // not the one the Orbit button itself lives on.
        setNodeControlPanelVisible(false);
      }
    },
    {
      // Cycle this instance's per-instance size, stored in instance.sizeMul (a
      // continuous float persisted in the .redstring file). NOT instance.scale —
      // that field is the transient drag-lift transform register (1 at rest), so
      // reusing it would make nodes re-wrap text on grab and lose their size on
      // drop. nextNodeSizeStep snaps the current value to the nearest named step
      // and advances (M → L → XL → XS → S → M). getNodeDimensions + Node.jsx fold
      // sizeMul into an effective node scale, so both the box and its label grow
      // together, on top of the global node-size scope.
      id: 'change-size',
      label: (() => {
        // Whichever menu is actually up. The control panel can outlive the pie
        // menu on the same Thing, and reading only the pie menu's target left
        // this reporting "Size: M" for an XL node in the panel's tooltip.
        const targetId = selectedNodeIdForPieMenu ?? singleSelectedInstanceId;
        const inst = nodes.find(n => n.id === targetId);
        return `Size: ${nodeSizeLabel(inst?.sizeMul ?? 1.0)}`;
      })(),
      icon: Scaling,
      action: (instanceId) => {
        const instance = nodes.find(n => n.id === instanceId);
        if (!instance || !activeGraphId) return;
        const next = nextNodeSizeStep(instance.sizeMul ?? 1.0);
        storeActions.updateNodeInstance(
          activeGraphId,
          instanceId,
          (inst) => { inst.sizeMul = next; },
          { type: 'node_resize', finalize: true }
        );
        // The hover chip snapshots its label when the pointer enters the
        // button, so it would otherwise keep showing the pre-click size.
        // Refresh it in place (same id → same chip, instant text swap) so it
        // tracks the new size while the pointer stays on the button.
        if (getActionHoverItem()?.id === 'change-size') {
          setActivePieMenuItemForVision({ id: 'change-size', label: `Size: ${nodeSizeLabel(next)}` });
        }
      }
    }
  ];

  return [primaryPage, secondaryPage];
}

export function buildTargetPieMenuButtons(ctx) {
  const {
    abstractionCarouselNode, abstractionCarouselVisible, activeGraphId, carouselAnimationState,
    carouselFocusedNode, carouselPieMenuStage, currentAbstractionDimension, nodeDefinitionIndices,
    nodePieMenuPages, nodes, pieMenuPage, previewingNodeId, selectedNodeIdForPieMenu,
    setCarouselFocusPrototypeRequest, setGroupControlPanelShouldShow, setNodeControlPanelShouldShow,
    setNodeControlPanelVisible, setNodeDefinitionIndices, setSelectedGroup, setSelectedInstanceIds,
    startHurtleAnimation, storeActions, wizardEnabled,
  } = ctx;
  const selectedNode = selectedNodeIdForPieMenu ? nodes.find(n => n.id === selectedNodeIdForPieMenu) : null;

  // Check if we're in AbstractionCarousel mode
  // In stage 2, we might be using a focused node different from the original carousel node
  const isInCarouselMode = selectedNode && abstractionCarouselVisible && abstractionCarouselNode && selectedNode.id === abstractionCarouselNode.id;
  if (isInCarouselMode) {
    // AbstractionCarousel mode: different layouts based on stage
    if (carouselPieMenuStage === 1) {
      // Stage 1: Main carousel menu, laid out on the slot grid PieMenu's carousel
      // mode draws (see CAROUSEL_SLOTS there). Back hangs off the node's left edge;
      // the actions run off its right edge in two rows, spaced the same distance
      // apart in both axes:
      //   row 0: Swap, Create Definition, Delete
      //   row 1: Expand, Ask The Wizard
      return [
        {
          id: 'carousel-back',
          label: 'Back',
          icon: ArrowLeft,
          position: 'left-inner',
          action: (nodeId) => {
            // Raise the exit and click guards and shrink the pie; the carousel
            // closes when it has (CAROUSEL_BACK).
            dispatchPie({ type: 'CAROUSEL_BACK' });
          }
        },
        {
          id: 'carousel-swap',
          label: 'Swap',
          icon: SendToBack,
          position: 'right-inner',
          action: (originalNodeId) => {
            // Get the focused carousel node's prototype ID
            const focusedPrototypeId = carouselFocusedNode ? carouselFocusedNode.prototypeId : null;
            const originalInstance = nodes.find(n => n.id === originalNodeId);

            if (!originalInstance || !focusedPrototypeId) {
              dispatchPie({ type: 'CLICK_GUARD' });
              return;
            }

            // Store the swap operation to be executed after animations complete
            const currentState = useGraphStore.getState();
            const newPrototype = currentState.nodePrototypes.get(focusedPrototypeId);

            // Leave the carousel; the machine applies the swap once it has faded.
            dispatchPie({
              type: 'CAROUSEL_LEAVE',
              swap: { originalNodeId, originalInstance, focusedPrototypeId, newPrototype },
            });
          }
        },
        {
          id: 'carousel-plus',
          label: 'Create Definition',
          icon: Plus,
          position: 'right-second',
          action: (nodeId) => {

            console.log(`[PieMenu Action] State before transition:`, {
              carouselPieMenuStage,
              isCarouselStageTransition: false,
              selectedNodeIdForPieMenu
            });

            // Shrink the pie; the stage changes when it has (STAGE_REQUEST).
            dispatchPie({ type: 'STAGE_REQUEST' });
          }
        },
        {
          id: 'carousel-delete',
          label: 'Delete',
          icon: Trash2,
          position: 'right-third',
          action: (nodeId) => {
            dispatchPie({ type: 'CLICK_GUARD' });

            const selectedNode = carouselFocusedNode || nodes.find(n => n.id === nodeId);
            if (!selectedNode) {

              return;
            }

            // Get the current abstraction carousel data to find the original node
            const carouselNode = abstractionCarouselNode;
            if (!carouselNode) {

              return;
            }

            // Prevent deletion of the original node that the carousel is built around
            if (selectedNode.prototypeId === carouselNode.prototypeId) {

              return;
            }

            // The carousel's scroll position is a raw numeric "level" (e.g. +2),
            // not a reference to a specific node. Once the deleted node's chain
            // index is spliced out, every node past it re-indexes to a new level,
            // so leaving the scroll position where it was either strands it on
            // empty space (deleting the outermost item) or snaps it onto a
            // different node that slid into that level (deleting from the middle
            // of either the specific or generic side). Resolve the next focus
            // target by prototypeId (a neighbor in the chain) before removing,
            // then request focus by id the same way adding a layer does — that
            // lookup is robust to the re-indexing since it doesn't depend on the
            // stale level number.
            //
            // Resolve the owner rather than assuming it is the carousel anchor: this
            // used to read the anchor's own chain directly, so deleting a layer from a
            // ladder anchored on a mere member silently did nothing at all.
            const protoMap = useGraphStore.getState().nodePrototypes;
            const resolvedForDelete = resolveChain(
              carouselNode.prototypeId,
              currentAbstractionDimension,
              protoMap.values()
            );
            const chainOwnerForDelete = resolvedForDelete.ownerId;
            const chain = resolvedForDelete.chain || [];
            const removedIndex = chain.indexOf(selectedNode.prototypeId);
            const nextFocusPrototypeId = removedIndex !== -1
              ? (chain[removedIndex + 1] || chain[removedIndex - 1] || carouselNode.prototypeId)
              : carouselNode.prototypeId;

            // Remove the node from the abstraction chain
            storeActions.removeFromAbstractionChain(
              chainOwnerForDelete,          // the node whose chain we're modifying
              currentAbstractionDimension,  // dimension (Physical, Conceptual, etc.)
              selectedNode.prototypeId      // the node to remove
            );

            // Move carousel focus onto the neighbor that took its place.
            setCarouselFocusPrototypeRequest(nextFocusPrototypeId);

            // Don't close the pie menu after deletion - stay in the carousel to see the updated chain
            // setSelectedNodeIdForPieMenu(null);
            // setIsTransitioningPieMenu(true);
          }
        },
        {
          id: 'carousel-expand',
          label: 'Expand',
          icon: ArrowUpFromDot,
          position: 'right-inner',
          row: 1,
          action: (originalNodeId) => {
            console.log('[Carousel Expand] Up-dot clicked.', {
              originalNodeId,
              focusedCarouselNode: carouselFocusedNode ? {
                id: carouselFocusedNode.id,
                name: carouselFocusedNode.name,
                prototypeId: carouselFocusedNode.prototypeId
              } : null,
              activeGraphId,
              abstractionCarouselNode: abstractionCarouselNode ? {
                id: abstractionCarouselNode.id,
                name: abstractionCarouselNode.name,
                prototypeId: abstractionCarouselNode.prototypeId
              } : null,
              dimension: currentAbstractionDimension
            });
            dispatchPie({ type: 'CLICK_GUARD' });

            // In carousel mode, use the focused node's prototype for expansion operations
            const focusedPrototypeId = carouselFocusedNode ? carouselFocusedNode.prototypeId : null;
            const originalNodeData = nodes.find(n => n.id === originalNodeId);

            if (!originalNodeData) {

              return;
            }

            // Use focused node's prototype if available, otherwise use original node's prototype
            const targetPrototypeId = focusedPrototypeId || originalNodeData.prototypeId;

            console.log('[Carousel Expand] Resolved target prototype.', {
              targetPrototypeId,
              fromFocused: Boolean(focusedPrototypeId && focusedPrototypeId === targetPrototypeId)
            });

            // Get the prototype data to check for definitions
            const currentState = useGraphStore.getState();
            const prototypeData = currentState.nodePrototypes.get(targetPrototypeId);

            if (prototypeData) {
              if (prototypeData.definitionGraphIds && prototypeData.definitionGraphIds.length > 0) {
                // Node has definitions - use current definition index if available, otherwise first one
                const contextKey = `${targetPrototypeId}-${activeGraphId}`;
                const currentDefinitionIndex = nodeDefinitionIndices.get(contextKey) || 0;
                const definitionIndex = Math.min(currentDefinitionIndex, prototypeData.definitionGraphIds.length - 1);
                const graphIdToOpen = prototypeData.definitionGraphIds[definitionIndex];

                console.log('[Carousel Expand] Opening existing definition.', {
                  targetPrototypeId,
                  totalDefinitions: prototypeData.definitionGraphIds.length,
                  definitionIndex,
                  graphIdToOpen
                });

                // Use original node ID for hurtle animation (visual effect), but target prototype for the definition
                console.log('[Carousel Expand] Starting hurtle animation to existing definition.', {
                  fromInstanceId: originalNodeId,
                  toGraphId: graphIdToOpen,
                  definitionNodeId: targetPrototypeId
                });
                startHurtleAnimation(originalNodeId, graphIdToOpen, targetPrototypeId);
                // Close carousel after animation starts (the click guard is already up)
                dispatchPie({ type: 'CAROUSEL_LEAVE', raiseClickGuard: false });
              } else {
                // No definitions recorded. Try to find any existing graph already defining this prototype
                const sourceGraphId = activeGraphId; // Capture current graph before it changes
                let orphanGraphId = null;
                try {
                  for (const [gId, g] of currentState.graphs.entries()) {
                    if (Array.isArray(g.definingNodeIds) && g.definingNodeIds.includes(targetPrototypeId)) {
                      orphanGraphId = gId;
                      break;
                    }
                  }
                } catch (_) { }

                if (orphanGraphId) {
                  console.log('[Carousel Expand] Found existing definition graph not listed on prototype. Repairing and opening.', {
                    targetPrototypeId,
                    orphanGraphId
                  });
                  // Self-heal: add to prototype.definitionGraphIds if missing
                  storeActions.updateNodePrototype(targetPrototypeId, draft => {
                    draft.definitionGraphIds = Array.isArray(draft.definitionGraphIds) ? draft.definitionGraphIds : [];
                    if (!draft.definitionGraphIds.includes(orphanGraphId)) {
                      draft.definitionGraphIds.push(orphanGraphId);
                    }
                  });
                  console.log('[Carousel Expand] Starting hurtle animation to repaired definition.', {
                    fromInstanceId: originalNodeId,
                    toGraphId: orphanGraphId,
                    definitionNodeId: targetPrototypeId
                  });
                  startHurtleAnimation(originalNodeId, orphanGraphId, targetPrototypeId, sourceGraphId);
                  dispatchPie({ type: 'CAROUSEL_LEAVE', raiseClickGuard: false });
                } else {
                  // Create a new definition graph if none exists anywhere
                  console.log('[Carousel Expand] No definitions found. Creating a new definition graph for prototype.', {
                    targetPrototypeId,
                    sourceGraphId
                  });
                  storeActions.createAndAssignGraphDefinitionWithoutActivation(targetPrototypeId);
                  setTimeout(() => {
                    const updatedState = useGraphStore.getState();
                    const updatedNodeData = updatedState.nodePrototypes.get(targetPrototypeId);
                    if (updatedNodeData?.definitionGraphIds?.length > 0) {
                      const newGraphId = updatedNodeData.definitionGraphIds[updatedNodeData.definitionGraphIds.length - 1];
                      console.log('[Carousel Expand] New definition graph created. Launching animation.', {
                        targetPrototypeId,
                        newGraphId,
                        sourceGraphId
                      });
                      startHurtleAnimation(originalNodeId, newGraphId, targetPrototypeId, sourceGraphId);
                      dispatchPie({ type: 'CAROUSEL_LEAVE', raiseClickGuard: false });
                    } else {

                    }
                  }, 50);
                }
              }
            } else {

            }
          }
        },
        ...(wizardEnabled ? [{
          id: 'carousel-ask-wizard',
          label: 'Ask The Wizard',
          icon: Sparkles,
          position: 'right-second',
          row: 1,
          action: (originalNodeId) => {
            dispatchPie({ type: 'CLICK_GUARD' });

            // Same target resolution as Expand: act on whichever node the
            // carousel is focused on, falling back to the node it was opened from.
            const originalNodeData = nodes.find(n => n.id === originalNodeId);
            const targetPrototypeId = carouselFocusedNode?.prototypeId || originalNodeData?.prototypeId;
            if (!targetPrototypeId) return;

            // Ask about THIS chain, not this node's components: the carousel's
            // wizard action builds out the generalization ladder for the dimension
            // currently on screen.
            window.dispatchEvent(new CustomEvent('rs-ask-wizard-abstraction', {
              detail: { prototypeId: targetPrototypeId, dimension: currentAbstractionDimension }
            }));

            // Close the carousel: the wizard works in the left panel, and the
            // carousel holds the canvas view locked on the focused node.
            dispatchPie({ type: 'CAROUSEL_LEAVE', raiseClickGuard: false });
          }
        }] : [])
      ];
    } else if (carouselPieMenuStage === 2) {
      // Stage 2: Position selection menu - Back on left-inner, vertical stack on right

      const stage2Buttons = [
        {
          id: 'carousel-back-stage2',
          label: 'Back',
          icon: ArrowLeft,
          position: 'left-inner',
          action: (nodeId) => {
            // Shrink the pie; the stage changes when it has (STAGE_REQUEST).
            dispatchPie({ type: 'STAGE_REQUEST' });
          }
        },
        {
          id: 'carousel-add-above',
          label: 'Add Above',
          icon: CornerUpLeft,
          position: 'right-top',
          action: (nodeId) => {

            // In stage 2, use the focused carousel node, otherwise use the clicked node
            const targetNode = carouselPieMenuStage === 2 && carouselFocusedNode
              ? carouselFocusedNode
              : nodes.find(n => n.id === nodeId);

            console.log(`[PieMenu Action] Using target node for Add Above:`, {
              id: targetNode?.id,
              name: targetNode?.name,
              prototypeId: targetNode?.prototypeId,
              usingFocusedNode: carouselPieMenuStage === 2 && carouselFocusedNode
            });

            if (!targetNode) {

              return;
            }

            // Normalize to prototypeId for abstraction prompt
            const targetPrototype = getPrototypeIdFromItem(targetNode);
            // Set abstraction prompt with the target node (focused node in stage 2)
            dispatchPie({
              type: 'PROMPT_OPEN',
              prompt: {
                visible: true,
                name: '',
                color: null,
                direction: 'above',
                nodeId: targetPrototype,
                carouselLevel: abstractionCarouselNode, // Pass the carousel state
              },
            });

          }
        },
        {
          id: 'carousel-add-below',
          label: 'Add Below',
          icon: CornerDownLeft,
          position: 'right-bottom',
          action: (nodeId) => {

            // In stage 2, use the focused carousel node, otherwise use the clicked node
            const targetNode = carouselPieMenuStage === 2 && carouselFocusedNode
              ? carouselFocusedNode
              : nodes.find(n => n.id === nodeId);

            console.log(`[PieMenu Action] Using target node for Add Below:`, {
              id: targetNode?.id,
              name: targetNode?.name,
              prototypeId: targetNode?.prototypeId,
              usingFocusedNode: carouselPieMenuStage === 2 && carouselFocusedNode
            });

            if (!targetNode) {

              return;
            }

            // Normalize to prototypeId for abstraction prompt
            const targetPrototypeBelow = getPrototypeIdFromItem(targetNode);
            // Set abstraction prompt with the target node (focused node in stage 2)
            dispatchPie({
              type: 'PROMPT_OPEN',
              prompt: {
                visible: true,
                name: '',
                color: null,
                direction: 'below',
                nodeId: targetPrototypeBelow,
                carouselLevel: abstractionCarouselNode, // Pass the carousel state
              },
            });

          }
        }
      ];

      return stage2Buttons;
    }
  }

  if (selectedNode && previewingNodeId === selectedNode.id) {
    // If the selected node for the pie menu is the one being previewed, show only Compose
    // But don't show it if the carousel is exiting (only for non-carousel mode)
    if (!abstractionCarouselVisible && carouselAnimationState === 'exiting') {
      return []; // Return empty array to hide all buttons during carousel exit
    }

    // Decomposition radial menu: a horizontal row across the top of the node
    // (Open, Add, Delete, Compose — compose pinned top-right), plus ◀ / ▶ definition
    // navigation arrows flanking the node, each shown only when a definition exists in
    // that direction. This replaces the old on-node foreignObject buttons and mirrors
    // the same option set into the bottom control panel (decomposition mode).
    const decompPrototypeId = selectedNode.prototypeId;
    const decompState = useGraphStore.getState();
    const decompProto = decompState.nodePrototypes.get(decompPrototypeId);
    const decompDefIds = (decompProto?.definitionGraphIds) || [];
    const decompContextKey = `${decompPrototypeId}-${activeGraphId}`;
    const decompIndex = nodeDefinitionIndices.get(decompContextKey) || 0;
    const decompCurrentGraphId = decompDefIds[decompIndex] || null;
    const decompHasPrev = decompIndex > 0;
    const decompHasNext = decompIndex < decompDefIds.length - 1;
    const setDecompIndex = (idx) => setNodeDefinitionIndices(prev => new Map(prev).set(decompContextKey, idx));

    const compose = {
      id: 'compose-preview',
      label: 'Compose',
      icon: Package,
      action: () => {
        // Shrink the pie; the preview closes when it has (PIE_COMPOSE; ignored
        // while a carousel is exiting).
        dispatchPie({ type: 'PIE_COMPOSE' });
      }
    };

    // Empty state (node has no definitions yet): offer "+" to create the first
    // definition, plus Decompose (opens an empty node-group anchored here — creating
    // the definition graph too, if needed), with Compose pinned top-right.
    if (decompDefIds.length === 0) {
      return [
        {
          id: 'decomp-add',
          label: 'Add Definition',
          icon: Plus,
          position: 'top', topIndex: 0, topCount: 3,
          action: () => storeActions.createAndAssignGraphDefinitionWithoutActivation(decompPrototypeId)
        },
        {
          id: 'decomp-further-empty',
          label: 'Decompose',
          icon: PackageOpen,
          position: 'top', topIndex: 1, topCount: 3,
          action: () => {
            const createdGroupId = storeActions.decomposeEmptyNodeToGroup(activeGraphId, decompPrototypeId, decompIndex, previewingNodeId);
            if (!createdGroupId) return;
            dispatchPie({ type: 'PREVIEW_SET', id: null, endTransition: true });
            const gs = useGraphStore.getState();
            const newGroup = gs.graphs?.get(activeGraphId)?.groups?.get(createdGroupId);
            if (newGroup) {
              setSelectedGroup(newGroup);
              setSelectedInstanceIds(new Set());
              setGroupControlPanelShouldShow(true);
              setNodeControlPanelShouldShow(false);
              setNodeControlPanelVisible(false);
            }
          }
        },
        { ...compose, position: 'top', topIndex: 2, topCount: 3 }
      ];
    }

    // Has definitions: Open, Delete, Decompose Further (explode into a node-group in
    // place), Compose — plus ◀ / ▶ definition-navigation arrows.
    const decompButtons = [
      {
        id: 'decomp-open',
        label: 'Open',
        icon: ArrowUpFromDot,
        position: 'top', topIndex: 0, topCount: 5,
        action: (instanceId) => {
          if (decompCurrentGraphId) {
            startHurtleAnimation(instanceId, decompCurrentGraphId, decompPrototypeId);
          }
        }
      },
      {
        id: 'decomp-add',
        label: 'Add Definition',
        icon: Plus,
        position: 'top', topIndex: 1, topCount: 5,
        action: () => storeActions.createAndAssignGraphDefinitionWithoutActivation(decompPrototypeId)
      },
      {
        id: 'decomp-delete',
        label: 'Delete Definition',
        icon: Trash2,
        position: 'top', topIndex: 2, topCount: 5,
        action: () => {
          if (!decompCurrentGraphId) return;
          // Adjust the active index before removal: if deleting the last item, step back.
          const newLen = decompDefIds.length - 1;
          if (newLen > 0 && decompIndex >= newLen) {
            setDecompIndex(newLen - 1);
          } else if (newLen <= 0) {
            setDecompIndex(0);
          }
          storeActions.removeDefinitionFromNode(decompPrototypeId, decompCurrentGraphId);
        }
      },
      {
        id: 'decomp-further',
        label: 'Decompose Further',
        icon: PackageOpen,
        position: 'top', topIndex: 3, topCount: 5,
        action: () => {
          // Use the dedicated store action (copies the definition's instances + edges and
          // reuses the original node as the group anchor). The older handleNodeConvertToNodeGroup
          // path reimplemented this manually and left the group empty.
          // If the definition being previewed has no content yet (e.g. freshly added via
          // "Add Definition"), decomposeNodeToGroup has nothing to copy and aborts — open an
          // empty, buildable node-group instead.
          const currentDefGraph = decompCurrentGraphId ? decompState.graphs.get(decompCurrentGraphId) : null;
          const isCurrentDefEmpty = !currentDefGraph || !currentDefGraph.instances || currentDefGraph.instances.size === 0;
          const createdGroupId = isCurrentDefEmpty
            ? storeActions.decomposeEmptyNodeToGroup(activeGraphId, decompPrototypeId, decompIndex, previewingNodeId)
            : storeActions.decomposeNodeToGroup(activeGraphId, decompPrototypeId, decompIndex, previewingNodeId);
          if (!createdGroupId) return;
          dispatchPie({ type: 'PREVIEW_SET', id: null, endTransition: true });
          const gs = useGraphStore.getState();
          const newGroup = gs.graphs?.get(activeGraphId)?.groups?.get(createdGroupId);
          if (newGroup) {
            setSelectedGroup(newGroup);
            setSelectedInstanceIds(new Set());
            setGroupControlPanelShouldShow(true);
            setNodeControlPanelShouldShow(false);
            setNodeControlPanelVisible(false);
          }
        }
      },
      { ...compose, position: 'top', topIndex: 4, topCount: 5 }
    ];

    // Always include both arrows so they stay mounted and can animate in/out as you
    // reach the first/last definition; `hidden` collapses them (see PieMenu wrapper).
    decompButtons.push({
      id: 'decomp-prev',
      label: 'Previous Definition',
      icon: ChevronLeft,
      position: 'left-inner',
      hidden: !decompHasPrev,
      action: () => { if (decompHasPrev) setDecompIndex(decompIndex - 1); }
    });
    decompButtons.push({
      id: 'decomp-next',
      label: 'Next Definition',
      icon: ChevronRight,
      position: 'right-inner',
      hidden: !decompHasNext,
      action: () => { if (decompHasNext) setDecompIndex(decompIndex + 1); }
    });

    return decompButtons;
  } else {
    // Default buttons: Expand, Decompose, Connect, Delete, Edit (swapped edit and expand positions)
    // But don't show buttons if the carousel is exiting (only for non-carousel mode)
    if (!abstractionCarouselVisible && carouselAnimationState === 'exiting') {
      return []; // Return empty array to hide all buttons during carousel exit
    }

    // Hand off to the shared page list. Clamp instead of trusting pieMenuPage:
    // it is parent state that outlives any single menu, so it can still name a
    // page that no longer exists.
    return nodePieMenuPages[pieMenuPage] ?? nodePieMenuPages[0] ?? [];
  }
}

export function buildDecomposePanelInfo(ctx) {
  const {
    activeGraphId, nodeDefinitionIndices, nodePrototypesMap, nodes, previewingNodeId, setNodeDefinitionIndices,
  } = ctx;
  if (!previewingNodeId) return null;
  const node = nodes.find(n => n.id === previewingNodeId);
  if (!node) return null;
  const prototypeId = node.prototypeId;
  const proto = nodePrototypesMap.get(prototypeId);
  if (!proto) return null;
  const defIds = Array.isArray(proto.definitionGraphIds) ? proto.definitionGraphIds : [];
  const contextKey = `${prototypeId}-${activeGraphId}`;
  const index = nodeDefinitionIndices.get(contextKey) || 0;
  const currentGraphId = defIds[index] || null;
  return {
    instanceId: previewingNodeId,
    prototypeId,
    prototype: { id: prototypeId, name: proto.name, color: proto.color },
    defIds,
    index,
    currentGraphId,
    hasDefs: defIds.length > 0,
    hasPrev: index > 0,
    hasNext: index < defIds.length - 1,
    setIndex: (i) => setNodeDefinitionIndices(prev => new Map(prev).set(contextKey, i)),
  };
}
