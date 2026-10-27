/**
 * A box that has just opened (a Thing decomposed into its thing group) waits to be
 * framed. When it is selected, its pie comes up a commit or two later and frames
 * it by its title and menu, so no button lands off screen (GroupPieMenuLayer).
 * When nothing selects it, nothing claims the request, and the camera brings the
 * whole box into view instead (camera/framing.js).
 */
let pendingId = null;

/** Ask for `groupId` to be framed once it has opened. */
export function requestOpenedBoxFrame(groupId) { pendingId = groupId ?? null; }

/** Claim the request for `groupId`: true once, for whoever frames it. */
export function takeOpenedBoxFrame(groupId) {
  if (pendingId === null || pendingId !== groupId) return false;
  pendingId = null;
  return true;
}
