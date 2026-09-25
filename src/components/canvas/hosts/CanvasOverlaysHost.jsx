/**
 * The overlays NodeCanvas portals into the shell after the control panels
 * (P5.06a): the abstraction carousel, the colour pickers (ColorPickersHost), the add-to-group
 * and self-loop confirmations and the Ask The Wizard picker. Moved verbatim;
 * NodeCanvas passes their state and handlers as `ctx`. P5.04 and P5.06b move
 * that state and those handlers in here. The carousel's callbacks and axes come
 * from carousel/carouselActions.js and canvasUIStore (P5.04).
 */
import { Profiler } from 'react';
import { onRenderProbe } from '../../../utils/perf/renderProbe.js';
import AbstractionCarousel from '../../../AbstractionCarousel.jsx';
import ColorPickersHost from '../colorPickers/ColorPickersHost.jsx';
import useCanvasUIStore from '../../../store/canvasUIStore.js';
import {
  onCarouselAnimationStateChange, onCarouselClose, requestCarouselClose, onCarouselReplaceNode,
  changeAbstractionDimension as handleAbstractionDimensionChange, addAbstractionDimension as handleAddAbstractionDimension,
  deleteAbstractionDimension as handleDeleteAbstractionDimension, expandAbstractionDimension as handleExpandAbstractionDimension,
} from '../carousel/carouselActions.js';
import CanvasConfirmDialog from '../../shared/CanvasConfirmDialog.jsx';
import WizardHost from '../wizard/WizardHost.jsx';
import { v4 as uuidv4 } from 'uuid';

export default function CanvasOverlaysHost({ ctx }) {
  const {
    abstractionCarouselVisible, abstractionCarouselNode, panOffset, zoomLevel, zoomLevelRef, panOffsetRef,
    containerRef, canvasSize, debugMode, carouselAnimationState, setCarouselFocusedNodeScale,
    setCarouselFocusedNodeDimensions, setCarouselFocusedNode, onCarouselExitAnimationComplete,
    carouselRelativeMoveRequest, setCarouselRelativeMoveRequest, carouselFocusPrototypeRequest,
    setCarouselFocusPrototypeRequest, storeActions, currentAbstractionDimension,
    setAbstractionControlPanelVisible,
    addToGroupDialog, setAddToGroupDialog, activeGraphId,
    selfLoopDialog, setSelfLoopDialog,
  } = ctx;
  const abstractionDimensions = useCanvasUIStore((s) => s.abstractionDimensions);

  return (
    <Profiler id="CanvasOverlaysHost" onRender={onRenderProbe}>
      {/* AbstractionCarousel Component */}
      {
        abstractionCarouselVisible && abstractionCarouselNode && (
          <AbstractionCarousel
            isVisible={abstractionCarouselVisible}
            selectedNode={abstractionCarouselNode}
            panOffset={panOffset}
            zoomLevel={zoomLevel}
            liveZoomRef={zoomLevelRef}
            livePanRef={panOffsetRef}
            containerRef={containerRef}
            canvasSize={canvasSize}
            debugMode={debugMode}
            animationState={carouselAnimationState}
            onAnimationStateChange={onCarouselAnimationStateChange}
            onClose={onCarouselClose}
            onRequestClose={requestCarouselClose}
            onReplaceNode={onCarouselReplaceNode}
            onScaleChange={setCarouselFocusedNodeScale}
            onFocusedNodeDimensions={setCarouselFocusedNodeDimensions}
            onFocusedNodeChange={setCarouselFocusedNode}
            onExitAnimationComplete={onCarouselExitAnimationComplete}
            relativeMoveRequest={carouselRelativeMoveRequest}
            onRelativeMoveHandled={() => setCarouselRelativeMoveRequest(null)}
            focusPrototypeRequest={carouselFocusPrototypeRequest}
            onFocusPrototypeHandled={() => setCarouselFocusPrototypeRequest(null)}
            onOpenNodeInPanel={(item) => {
              const prototypeId = item?.prototypeId || item?.id;
              if (prototypeId && typeof storeActions.openRightPanelNodeTab === 'function') {
                storeActions.openRightPanelNodeTab(prototypeId, item?.name);
              }
            }}
            currentDimension={currentAbstractionDimension}
            availableDimensions={abstractionDimensions}
            onDimensionChange={handleAbstractionDimensionChange}
            onAddDimension={handleAddAbstractionDimension}
            onDeleteDimension={handleDeleteAbstractionDimension}
            onExpandDimension={handleExpandAbstractionDimension}
            onOpenInPanel={() => {
              // Open the abstraction control panel when user wants to open in panel
              setAbstractionControlPanelVisible(true);
            }}
          />
        )
      }

      {/* The three colour pickers (P5.06b) */}
      <ColorPickersHost ctx={ctx} />

      {/* Add to Group Dialog */}
      {
        addToGroupDialog && (
          <CanvasConfirmDialog
            isOpen={true}
            onClose={() => setAddToGroupDialog(null)}
            onConfirm={() => {
              // Add all dragged nodes to the group
              if (activeGraphId && addToGroupDialog.groupId && addToGroupDialog.nodeIds) {
                // Not a plain updateGroup: dropping into a nested group has to add
                // the node to its containing groups as well, or the group falls out
                // of the containment hierarchy. See addInstancesToGroup.
                storeActions.addInstancesToGroup(
                  activeGraphId,
                  addToGroupDialog.groupId,
                  addToGroupDialog.nodeIds
                );
                console.log(`Added ${addToGroupDialog.nodeIds.length} node(s) to ${addToGroupDialog.isNodeGroup ? 'Thing' : 'group'} "${addToGroupDialog.groupName}"`);
              }
              setAddToGroupDialog(null);
            }}
            title={`Add to ${addToGroupDialog.isNodeGroup ? 'Thing' : 'Group'}?`}
            message={`Add ${addToGroupDialog.nodeIds.length > 1 ? `${addToGroupDialog.nodeIds.length} nodes` : 'this node'} to ${addToGroupDialog.isNodeGroup ? 'the Thing' : 'the group'} "${addToGroupDialog.groupName}"?`}
            confirmLabel="Add"
            cancelLabel="Cancel"
            variant="default"
            position={addToGroupDialog.position}
            containerRect={containerRef.current?.getBoundingClientRect()}
            panOffset={panOffset}
            zoomLevel={zoomLevel}
          />
        )
      }

      {/* Ask The Wizard: the picker and its window events (P5.06b). */}
      <WizardHost />

      {/* Self-referential connection confirmation */}
      {selfLoopDialog && (
        <CanvasConfirmDialog
          isOpen={true}
          onClose={() => setSelfLoopDialog(null)}
          onConfirm={() => {
            if (activeGraphId && selfLoopDialog.sourceInstanceId) {
              storeActions.addEdge(activeGraphId, {
                id: uuidv4(),
                sourceId: selfLoopDialog.sourceInstanceId,
                destinationId: selfLoopDialog.sourceInstanceId
              });
            }
            setSelfLoopDialog(null);
          }}
          title="Self-referential connection?"
          message="Connect this Thing to itself?"
          confirmLabel="Connect"
          cancelLabel="Cancel"
          variant="default"
          position={selfLoopDialog.position}
          containerRect={containerRef.current?.getBoundingClientRect()}
          panOffset={panOffset}
          zoomLevel={zoomLevel}
        />
      )}

    </Profiler>
  );
}
