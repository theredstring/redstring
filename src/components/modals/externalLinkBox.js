/**
 * Asking for the Load from External Link box. It lives inside UniverseManager,
 * which isn't mounted until the Universes panel is showing, so a request made
 * with the panel closed has to wait for it.
 */

export const OPEN_EXTERNAL_LINK_EVENT = 'redstring:open-external-link';

let requested = false;

export function requestExternalLinkBox() {
  requested = true;
  window.dispatchEvent(new CustomEvent(OPEN_EXTERNAL_LINK_EVENT));
}

/** Whether a request is waiting. Answers once. */
export function takeExternalLinkBoxRequest() {
  const wasRequested = requested;
  requested = false;
  return wasRequested;
}
