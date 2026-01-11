import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';

/**
 * History store for managing undo/redo stack.
 * Stores a single linear timeline of actions with domain tagging.
 */
const useHistoryStore = create((set, get) => ({
    // Single linear timeline
    history: [],           // All actions in chronological order
    currentIndex: -1,      // Points to "now" (-1 = at end)
    maxHistorySize: 100,

    // Push a new action
    pushAction: (entry) => set(state => {
        // If we're not at the end, truncate redo history
        // This happens when you undo some actions and then perform a new action
        const newHistory = state.currentIndex === -1
            ? state.history
            : state.history.slice(0, state.history.length + state.currentIndex + 1);

        // Flatten domain if it's an object (just in case)
        const domain = typeof entry.domain === 'object' ? 'global' : entry.domain;

        const action = {
            id: uuidv4(),
            timestamp: Date.now(),
            ...entry,
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

    // Undo within a domain - Placeholder for Phase 2
    undoInDomain: (domain) => {
        // TODO: Implement with Immer patches
        console.log(`[History] Undo requested for domain: ${domain}`);
    },

    // Redo within a domain - Placeholder for Phase 2
    redoInDomain: (domain) => {
        // TODO: Implement with Immer patches
        console.log(`[History] Redo requested for domain: ${domain}`);
    },

    // Helpers mainly for UI state
    canUndo: () => {
        const { history, currentIndex } = get();
        // If currentIndex is -1, we are at the end, so we can undo if history is not empty
        if (currentIndex === -1) return history.length > 0;
        // If currentIndex is < -1, we are traversing back. 
        // e.g. -2 means we undid the last action.
        // The index represents the pointer RELATIVE TO THE END.
        // Actually, let's rethink the indexing to be absolute or standard pointer.

        // Standard approach:
        // history = [A, B, C]
        // pointer = 2 (pointing at C). Undo -> pointer = 1.
        // 
        // Let's keep the `currentIndex` as a relative pointer from the end for simplicity in adding items?
        // "currentIndex: -1 (Points to 'now' (-1 = at end))" from the plan.
        // If history length is 5.
        // -1 = after last item (current state).
        // -2 = after 4th item (1 undo performed).
        // ...
        // -(length + 1) = before first item.

        const effectiveIndex = history.length + currentIndex + 1;
        return effectiveIndex > 0;
    },

    canRedo: () => {
        const { currentIndex } = get();
        return currentIndex < -1;
    },

    // Clear all history
    clearHistory: () => set({ history: [], currentIndex: -1 }),
}));

export default useHistoryStore;
