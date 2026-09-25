/**
 * Panel-toggle and TypeList keyboard shortcuts (moved verbatim from NodeCanvas).
 * They work even while an input has focus. Attaches the listener and returns
 * the cleanup.
 */
import useGraphStore from '../../../store/graphStore.js';

/** Attach the shell shortcut listener; returns its cleanup. */
export function listenForShellShortcuts(ctx) {
  const {
    setHeaderSearchVisible, setNewWebPrompt, handleToggleLeftPanel, handleToggleRightPanel, storeActions,
  } = ctx;
  /**
   * Global keydown handler registered on `document` (not the SVG element).
   *
   * Runs even when focus is inside a text input so panel shortcuts remain
   * available while editing node descriptions. Text-input-aware: destructive
   * shortcuts (Delete, Backspace) are suppressed when the active element is
   * editable. Handled keys:
   * - **Cmd/Ctrl+F**: opens the graph search header.
   * - **Escape**: closes search, dismisses PieMenu, clears edge-creation state.
   * - **Delete / Backspace**: deletes the selected node(s) or edge when canvas has focus.
   * - **Cmd/Ctrl+Z**: undo; **Cmd/Ctrl+Shift+Z** or **Cmd/Ctrl+Y**: redo.
   * - **Tab**: cycles the right-panel tab focus.
   *
   * @param {KeyboardEvent} e - The keydown event.
   */
  const handleGlobalKeyDown = (e) => {
    // Check for Cmd+F (Mac) or Ctrl+F (Windows/Linux) to open Graph Search
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      setHeaderSearchVisible(true);
      return;
    }

    // Cmd/Ctrl+N: the header's + by keyboard. Deliberately not guarded on
    // text input, same as Cmd+F above — it is a global command, not a
    // canvas one.
    //
    // Browsers reserve Cmd/Ctrl+N for "new window" and never deliver the
    // keydown here, so in a normal tab this listener simply never runs. It
    // does run in the desktop app (which routes it through the File menu's
    // accelerator, see electron/main.cjs) and in an installed PWA window.
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'n') {
      e.preventDefault();
      setNewWebPrompt({ visible: true });
      return;
    }

    // Check if focus is on a text input to prevent conflicts
    const activeElement = document.activeElement;
    const isTextInput = activeElement && (
      activeElement.tagName === 'INPUT' ||
      activeElement.tagName === 'TEXTAREA' ||
      activeElement.contentEditable === 'true' ||
      activeElement.type === 'text' ||
      activeElement.type === 'search' ||
      activeElement.type === 'password' ||
      activeElement.type === 'email' ||
      activeElement.type === 'number'
    );

    // Only handle these specific keys if NOT in a text input
    if (!isTextInput) {
      if (e.key === '1') {
        e.preventDefault();
        handleToggleLeftPanel();
      } else if (e.key === '2') {
        e.preventDefault();
        handleToggleRightPanel();
      } else if (e.key === '3') {
        e.preventDefault();

        // Cycle TypeList mode: connection -> node -> component -> closed -> connection
        const currentMode = useGraphStore.getState().typeListMode;
        const newMode = currentMode === 'connection' ? 'node' :
          currentMode === 'node' ? 'component' :
            currentMode === 'component' ? 'closed' : 'connection';

        storeActions.setTypeListMode(newMode);

      }
    }
  };

  document.addEventListener('keydown', handleGlobalKeyDown);
  return () => document.removeEventListener('keydown', handleGlobalKeyDown);
}
