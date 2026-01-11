import React from 'react';
import useHistoryStore from '../store/historyStore';
import useGraphStore from '../store/graphStore';
import { Undo2, Redo2 } from 'lucide-react';
import './UndoRedoButtons.css';

const UndoRedoButtons = () => {
    const { undo, redo, canUndo, canRedo } = useHistoryStore();
    const applyPatches = useGraphStore(state => state.applyPatches);

    const handleUndo = (e) => {
        e.stopPropagation();
        undo(applyPatches);
    };

    const handleRedo = (e) => {
        e.stopPropagation();
        redo(applyPatches);
    };

    // Keyboard shortcuts
    React.useEffect(() => {
        const handleKeyDown = (e) => {
            // Check for Ctrl+Z or Cmd+Z
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
                const isRedo = e.shiftKey;

                // Prevent default browser undo/redo
                e.preventDefault();
                e.stopPropagation();

                if (isRedo) {
                    if (canRedo()) redo(applyPatches);
                } else {
                    if (canUndo()) undo(applyPatches);
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [undo, redo, canUndo, canRedo, applyPatches]);

    return (
        <div className="undo-redo-container">
            <button
                className="undo-redo-btn"
                onClick={handleUndo}
                disabled={!canUndo()}
                title="Undo (Ctrl+Z)"
            >
                <Undo2 size={20} />
            </button>
            <button
                className="undo-redo-btn"
                onClick={handleRedo}
                disabled={!canRedo()}
                title="Redo (Ctrl+Shift+Z)"
            >
                <Redo2 size={20} />
            </button>
        </div>
    );
};

export default UndoRedoButtons;
