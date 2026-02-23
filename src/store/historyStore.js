import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import { applyPatches } from 'immer';

/**
 * History store for managing undo/redo stack.
 * Stores a single linear timeline of actions with patch-based undo/redo.
 */
const useHistoryStore = create((set, get) => ({
    // Single linear timeline
    history: [],           // All actions in chronological order
    currentIndex: -1,      // Points to "now" (-1 = at end)
    maxHistorySize: 500,

    // Push a new action with patches
    pushAction: (entry) => set(state => {
        // If we're not at the end, truncate redo history
        const newHistory = state.currentIndex === -1
            ? state.history
            : state.history.slice(0, state.history.length + state.currentIndex + 1);

        // Deduplication Logic:
        // Check if the new entry is identical to the last one (double-fire protection)
        const lastAction = newHistory[newHistory.length - 1];
        if (lastAction) {
            const isSameType = lastAction.actionType === entry.actionType;
            const isSameDesc = lastAction.description === entry.description;
            const isRecent = (Date.now() - lastAction.timestamp) < 500; // Within 500ms

            if (isSameType && isSameDesc && isRecent) {
                // deep check patches
                const isSamePatches = JSON.stringify(lastAction.patches) === JSON.stringify(entry.patches);
                if (isSamePatches) {
                    console.warn('[History] Duplicate action ignored:', entry.description);
                    return state; // No change
                }
            }
        }

        // Flatten domain if it's an object (just in case)
        const domain = typeof entry.domain === 'object' ? 'global' : entry.domain;

        const action = {
            id: uuidv4(),
            timestamp: Date.now(),
            ...entry, // This now includes patches, inversePatches, description, actionId, isWizard, etc.
            domain
        };

        // Enforce max size
        const trimmed = newHistory.length >= state.maxHistorySize
            ? newHistory.slice(1)
            : newHistory;

        return {
            history: [...trimmed, action],
            currentIndex: -1  // Reset to end
        };
    }),

    // Get actions for a specific domain
    // domain: 'all' | 'global' | 'graph-{graphId}'
    getHistoryForDomain: (domain) => {
        const { history } = get();
        if (domain === 'all') return history;
        return history.filter(h => h.domain === domain);
    },

    // Undo action (generic)
    // The application logic needs to pass a callback to apply the patches to the correct store
    undo: (applyFn) => {
        const { history, currentIndex } = get();
        // Calculate the effective index of the item we want to undo
        // currentIndex = -1 means we are at the end, so we want to undo the LAST item (index history.length - 1)
        // currentIndex = -2 means we already undid the last item, so want to undo (history.length - 2)

        const effectiveIndex = history.length + currentIndex;

        if (effectiveIndex < 0) {
            console.warn('[History] Nothing to undo');
            return;
        }

        const entry = history[effectiveIndex];

        if (!entry.inversePatches) {
            console.warn('[History] No inverse patches for this action', entry);
            return;
        }

        console.log(`[History] Undoing: ${entry.description}`);

        // callback to apply patches to the relevant store (graphStore)
        applyFn(entry.inversePatches);

        set({ currentIndex: currentIndex - 1 });
    },

    // Redo action
    redo: (applyFn) => {
        const { history, currentIndex } = get();

        // If currentIndex is -1, there is nothing to redo (we are at current head)
        if (currentIndex >= -1) {
            console.warn('[History] Nothing to redo');
            return;
        }

        // currentIndex is e.g. -2 (we are behind by 1 step). The item to REDO is the next one.
        // effective index of current state is history.length - 2.
        // next item is at history.length - 2 + 1 = history.length - 1.

        const nextEffectiveIndex = history.length + currentIndex + 1;
        const entry = history[nextEffectiveIndex];

        if (!entry.patches) {
            console.warn('[History] No patches for this action', entry);
            return;
        }

        console.log(`[History] Redoing: ${entry.description}`);

        applyFn(entry.patches);

        set({ currentIndex: currentIndex + 1 });
    },

    // Jump to a specific point in time
    jumpTo: (targetIndex, applyFn) => {
        const { history, currentIndex } = get();
        const currentEffective = history.length + currentIndex;

        if (targetIndex === currentEffective) return;

        const maxSteps = 100;
        let steps = 0;

        // Note: We use get().currentIndex in loop because standard closure 'currentIndex' won't update
        if (targetIndex < currentEffective) {
            // Undo back to target
            while ((get().history.length + get().currentIndex) > targetIndex && steps < maxSteps) {
                get().undo(applyFn);
                steps++;
            }
        } else {
            // Redo forward to target
            while ((get().history.length + get().currentIndex) < targetIndex && steps < maxSteps) {
                get().redo(applyFn);
                steps++;
            }
        }
    },

    // Helpers mainly for UI state
    canUndo: () => {
        const { history, currentIndex } = get();
        return (history.length + currentIndex) >= 0;
    },

    canRedo: () => {
        const { currentIndex } = get();
        return currentIndex < -1;
    },

    // Clear all history
    clearHistory: () => set({ history: [], currentIndex: -1 }),
}));

export default useHistoryStore;
