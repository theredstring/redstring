/**
 * Submitting the abstraction prompt: add a more or less specific concept to
 * the chain (moved verbatim from NodeCanvas's handleAbstractionSubmit).
 * NodeCanvas passes the render values it used as `ctx`.
 */
import { interpolateColor } from '../../../utils/canvas/colorUtils.js';
import { resolveChain } from '../../../wizard/tools/utils/abstractionSpec.js';
import useGraphStore from '../../../store/graphStore.js';
import { v4 as uuidv4 } from 'uuid';

export function submitAbstraction({ name, color, existingPrototypeId }, ctx) {
  const {
    abstractionCarouselNode, abstractionPrompt, currentAbstractionDimension, nodePrototypesMap, nodes, setAbstractionCarouselVisible,
    setAbstractionPrompt, setCarouselFocusPrototypeRequest, setCarouselPieMenuStage, setIsCarouselStageTransition, setSelectedNodeIdForPieMenu, storeActions,
  } = ctx;

  if (name.trim() && abstractionPrompt.nodeId && abstractionCarouselNode) {
    // The nodeId could be either a canvas instance ID or a prototype ID (from focused carousel node)
    let currentlySelectedNode = nodes.find(n => n.id === abstractionPrompt.nodeId);
    let targetPrototypeId = null;

    if (currentlySelectedNode) {
      // Found canvas instance - use its prototype ID
      targetPrototypeId = currentlySelectedNode.prototypeId;
      console.log(`[Abstraction Submit] Found canvas instance node:`, {
        id: currentlySelectedNode.id,
        name: currentlySelectedNode.name,
        prototypeId: currentlySelectedNode.prototypeId
      });
    } else {
      // Not found as canvas instance - might be a prototype ID from focused carousel node
      const nodePrototype = nodePrototypesMap.get(abstractionPrompt.nodeId);
      if (nodePrototype) {
        targetPrototypeId = abstractionPrompt.nodeId;
        // Create a mock node object for the rest of the function
        currentlySelectedNode = {
          id: nodePrototype.id,
          name: nodePrototype.name,
          prototypeId: nodePrototype.id,
          color: nodePrototype.color
        };
        console.log(`[Abstraction Submit] Found prototype node:`, {
          id: nodePrototype.id,
          name: nodePrototype.name,
          prototypeId: nodePrototype.id
        });
      }
    }

    console.log(`[Abstraction Submit] RESOLVED NODE INFO:`, {
      promptNodeId: abstractionPrompt.nodeId,
      foundNodeId: currentlySelectedNode?.id,
      foundNodeName: currentlySelectedNode?.name,
      targetPrototypeId: targetPrototypeId,
      carouselNodeId: abstractionCarouselNode.id,
      carouselNodeProtoId: abstractionCarouselNode.prototypeId,
      direction: abstractionPrompt.direction
    });

    if (!currentlySelectedNode || !targetPrototypeId) {

      return;
    }

    // Resolve the chain owner EXACTLY the way the carousel does, anchored on the
    // carousel's own node (abstractionCarouselNode), NOT the focused node. The
    // carousel displays the anchor's chain: its own chain if it owns one, else
    // the chain that contains the anchor. If we instead searched by the focused
    // node's prototype (as before), it could match a *different*, pre-existing
    // axis chain that happens to contain that prototype — so the add would land
    // in an axis you're not looking at and never appear in the open carousel.
    // We still insert relative to the focused node (targetPrototypeId) within
    // that resolved chain.
    //
    // Resolution goes through the shared helper so it cannot drift from what the
    // carousel drew. A plain "does the anchor own a chain?" test no longer answers
    // this: every node carries a seeded chain, so that test is always true, and the
    // ladder the anchor is actually a rung of would never be found. The add would then
    // splice this ladder's rungs into the anchor's trivial chain and leave two
    // competing chains over the same nodes.
    const currentStateForChain = useGraphStore.getState();
    const allPrototypes = currentStateForChain.nodePrototypes;
    const anchorPrototypeId = abstractionCarouselNode.prototypeId;
    let chainOwnerPrototypeId = anchorPrototypeId;
    try {
      chainOwnerPrototypeId = resolveChain(
        anchorPrototypeId,
        currentAbstractionDimension,
        allPrototypes.values()
      ).ownerId;
    } catch (_) {
      // Fall back to the carousel node as owner
    }

    // Determine the node to insert into the chain: existing or new.
    // Wrapped so creating the prototype and wiring it into the chain are one
    // undo step — previously only the prototype was recorded, so undo left an
    // orphan prototype with the chain untouched (and recorded nothing at all
    // when an existing prototype was chosen).
    let newNodeId = existingPrototypeId;
    storeActions.withHistoryTransaction('Added abstraction layer', () => {
    if (!newNodeId) {
      // Create new node with color gradient
      let newNodeColor = color;
      if (!newNodeColor) {
        const isAbove = abstractionPrompt.direction === 'above';
        const abstractionLevel = isAbove ? 0.3 : -0.2;
        const targetColor = isAbove ? '#EFE8E5' : '#000000';
        newNodeColor = interpolateColor(currentlySelectedNode.color || '#8B0000', targetColor, Math.abs(abstractionLevel));
      }

      // Create the new node prototype
      storeActions.addNodePrototype({
        id: (newNodeId = uuidv4()),
        name: name.trim(),
        color: newNodeColor,
        typeNodeId: 'base-thing-prototype',
        definitionGraphIds: []
      });
    } else {

    }

    // Add to the abstraction chain relative to the currently selected/focused node
    // Use the resolved chain owner rather than always the carousel node
    console.log(`[Abstraction Submit] About to call addToAbstractionChain with:`, {
      chainOwnerNodeId: chainOwnerPrototypeId,
      dimension: currentAbstractionDimension,
      direction: abstractionPrompt.direction,
      newNodeId: newNodeId,
      insertRelativeToNodeId: currentlySelectedNode.prototypeId
    });

    storeActions.addToAbstractionChain(
      chainOwnerPrototypeId,                   // the node whose chain we're modifying (actual chain owner)
      currentAbstractionDimension,            // dimension (Physical, Conceptual, etc.)
      abstractionPrompt.direction,            // 'above' or 'below'
      newNodeId,                              // the node to add (existing or newly created)
      targetPrototypeId                       // insert relative to this node (focused node in carousel)
    );
    });

    // Close the abstraction prompt and keep the carousel visible.
    setAbstractionPrompt({ visible: false, name: '', color: null, direction: 'above', nodeId: null, carouselLevel: null });
    setAbstractionCarouselVisible(true); // Ensure carousel stays visible

    // Move the carousel focus to the layer we just added so the user sees it,
    // then drop straight back to stage 1 (the main Swap/Add/Delete/Expand menu)
    // — like the plus button cycles you in and right back out after each add.
    setCarouselFocusPrototypeRequest(newNodeId);
    setCarouselPieMenuStage(1);
    setIsCarouselStageTransition(false);

    // Ensure the carousel node is still selected for pie menu
    if (abstractionCarouselNode) {
      setSelectedNodeIdForPieMenu(abstractionCarouselNode.id);
    }
  }
}
