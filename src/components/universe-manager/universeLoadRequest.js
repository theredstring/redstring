/**
 * Asking the Universes panel to load an existing universe: from a file, or
 * from a repository. The panel (UniverseManager) isn't mounted until it is
 * showing, so a request made with it closed (from onboarding's "Open an
 * Existing Universe") waits here for it, as externalLinkBox.js does for links.
 *
 * A request is { source: 'file', file } (a File, picked where the platform can
 * only import a copy), { source: 'handle', handle } (a file picked where it can
 * stay linked: a desktop path or a browser FileHandle), or { source: 'repo' }.
 */

export const UNIVERSE_LOAD_EVENT = 'redstring:load-universe';

let pending = null;

export function requestUniverseLoad(request) {
  pending = request;
  window.dispatchEvent(new CustomEvent(UNIVERSE_LOAD_EVENT));
}

/** The waiting request, if any. Answers once. */
export function takeUniverseLoadRequest() {
  const request = pending;
  pending = null;
  return request;
}
