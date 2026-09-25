/**
 * Renders the three colour pickers (P5.06b; JSX and change handlers moved
 * verbatim from NodeCanvas / CanvasOverlaysHost). Open/closed state is
 * useColorPickerStore's; `ctx` carries the canvas values a colour change needs.
 */
import ColorPicker from '../../../ColorPicker';
import { NODE_DEFAULT_COLOR, CONNECTION_DEFAULT_COLOR } from '../../../constants';
import useCanvasUIStore from '../../../store/canvasUIStore.js';
import { useColorPickerStore, closeDialogColorPicker, closePieMenuColorPicker, closeEdgeColorPicker } from './colorPickers.js';

export default function ColorPickersHost({ ctx }) {
  const {
    selectedGroupEffectiveColor, nodeNamePrompt, connectionNamePrompt, setNodeNamePrompt,
    setConnectionNamePrompt, setSelectedGroup, nodes, nodePrototypesMap, activeGraphId, storeActions,
  } = ctx;
  const {
    dialogColorPickerVisible, dialogColorPickerPosition, colorPickerTarget, pieMenuColorPickerVisible,
    pieMenuColorPickerPosition, activePieMenuColorNodeId, edgeColorPickerVisible, edgeColorPickerPosition,
    activeEdgeColorPrototypeId,
  } = useColorPickerStore();

  const handleDialogColorChange = (color) => {
    if (colorPickerTarget?.type === 'group') {
      if (activeGraphId && colorPickerTarget.id) {
        storeActions.updateGroup(activeGraphId, colorPickerTarget.id, (draft) => {
          draft.color = color;
        });
        // Update local state immediately for responsiveness
        setSelectedGroup(prev => prev && prev.id === colorPickerTarget.id ? { ...prev, color } : prev);
      }
    } else if (nodeNamePrompt.visible) {
      setNodeNamePrompt(prev => ({ ...prev, color }));
    } else if (connectionNamePrompt.visible) {
      setConnectionNamePrompt(prev => ({ ...prev, color }));
    }
  };

  const handlePieMenuColorChange = (color) => {
    if (!activePieMenuColorNodeId) return;
    const selectedInstanceIds = useCanvasUIStore.getState().selectedInstanceIds;
    // The picker was opened from a multi-selection (the control panel anchors it
    // on a selected instance), so it recolours the whole selection — otherwise
    // Palette silently repainted one Thing out of the several that were selected.
    const targetIds = selectedInstanceIds.size > 1 && selectedInstanceIds.has(activePieMenuColorNodeId)
      ? Array.from(selectedInstanceIds)
      : [activePieMenuColorNodeId];
    // Two instances can share a prototype; recolouring it twice would be a no-op
    // with a second history entry attached.
    const prototypeIds = new Set(
      targetIds.map(id => nodes.find(n => n.id === id)?.prototypeId).filter(Boolean)
    );
    prototypeIds.forEach(prototypeId => {
      // Coalesced across the drag; committed by handlePieMenuColorCommit.
      storeActions.updateNodePrototype(prototypeId, draft => {
        draft.color = color;
      }, { coalesce: `node-color:${prototypeId}` });
    });
  };

  const handleEdgeColorChange = (color) => {
    if (!activeEdgeColorPrototypeId) return;
    // Coalesced across the drag; committed by handleEdgeColorCommit, so a whole
    // picker session is one undo step.
    storeActions.updateNodePrototype(activeEdgeColorPrototypeId, draft => {
      draft.color = color;
    }, { coalesce: `node-color:${activeEdgeColorPrototypeId}` });
  };

  const handleColorCommit = () => {
    storeActions.flushHistory?.();
  };

  return (
    <>
      {/* Dialog Color Picker Component */}
      {
        dialogColorPickerVisible && (
          <ColorPicker
            isVisible={dialogColorPickerVisible}
            onClose={closeDialogColorPicker}
            onColorChange={handleDialogColorChange}
            currentColor={
              colorPickerTarget?.type === 'group'
                ? (selectedGroupEffectiveColor || 'maroon')
                : (nodeNamePrompt.visible
                  ? (nodeNamePrompt.color || NODE_DEFAULT_COLOR)
                  : (connectionNamePrompt.color || NODE_DEFAULT_COLOR))
            }
            position={dialogColorPickerPosition}
            direction="down-left"
          />
        )
      }

      {/* Pie Menu Color Picker Component */}
      {
        pieMenuColorPickerVisible && activePieMenuColorNodeId && (
          <ColorPicker
            isVisible={pieMenuColorPickerVisible}
            onClose={closePieMenuColorPicker}
            onColorChange={handlePieMenuColorChange}
            onColorCommit={handleColorCommit}
            currentColor={(() => {
              const node = nodes.find(n => n.id === activePieMenuColorNodeId);
              return node?.color || 'maroon';
            })()}
            position={pieMenuColorPickerPosition}
            direction="down-left"
          />
        )
      }

      {/* Connection Color Picker — recolours the Thing that defines the connection */}
      {
        edgeColorPickerVisible && activeEdgeColorPrototypeId && (
          <ColorPicker
            isVisible={edgeColorPickerVisible}
            onClose={closeEdgeColorPicker}
            onColorChange={handleEdgeColorChange}
            onColorCommit={handleColorCommit}
            currentColor={nodePrototypesMap.get(activeEdgeColorPrototypeId)?.color || CONNECTION_DEFAULT_COLOR}
            position={edgeColorPickerPosition}
            direction="down-left"
          />
        )
      }
    </>
  );
}
