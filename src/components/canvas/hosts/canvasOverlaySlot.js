import { createContext } from 'react';

/**
 * Where NodeCanvas puts its screen-level overlays (control panels, colour
 * pickers, modals), provided by CanvasShell (P2.11). `undefined` means no
 * shell: NodeCanvas renders them inline, as it does in tests. `null` means the
 * slot isn't attached yet: render nothing for that one commit, so nothing
 * mounts twice.
 */
export const CanvasOverlaySlot = createContext(undefined);
