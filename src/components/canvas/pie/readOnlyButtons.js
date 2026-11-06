/**
 * While a universe is open read-only, what can't be done stays where it is,
 * dimmed, with its label saying why. Only what's listed here stays live, so
 * a new editing button dims without anyone having to remember it.
 */

import { isReadOnlyUniverseOpen } from '../../../store/readOnlyUniverse.js';

export const READ_ONLY_HINT = 'Make a copy to edit';

const LOOKING_AROUND = new Set([
  // A Thing
  'expand-tab', 'decompose-preview', 'abstraction', 'open-in-panel', 'copy', 'semantic-search', 'orbit', 'ask-wizard',
  // Flipping through its definitions
  'compose-preview', 'decomp-open', 'decomp-prev', 'decomp-next',
  // The abstraction carousel
  'carousel-back', 'carousel-back-stage2', 'carousel-expand',
  // A connection
  'edge-open-def', 'edge-open-panel', 'edge-copy',
  // A group
  'group-open-def', 'group-open-panel', 'group-names',
]);

const LOOKING_AROUND_MENU = new Set([
  'Open Web', 'Open in Panel', 'Decompose', 'Generalize / Specify', 'Semantic Orbit', 'Copy', 'Refresh',
]);

/**
 * Pie menu buttons, dimmed unless they only look.
 * @param {object[]} buttons
 * @param {(button: object) => boolean} [alsoDim] - a looking button that can't do anything here
 */
export function dimEditsWhenReadOnly(buttons, alsoDim) {
  if (!isReadOnlyUniverseOpen()) return buttons;
  return buttons.map((button) => (
    LOOKING_AROUND.has(button.id) && !alsoDim?.(button)
      ? button
      : { ...button, disabled: true, label: READ_ONLY_HINT }
  ));
}

/** Context menu options, dimmed unless they only look. */
export function dimMenuEditsWhenReadOnly(options) {
  if (!isReadOnlyUniverseOpen()) return options;
  return options.map((option) => (
    LOOKING_AROUND_MENU.has(option.label) ? option : { ...option, disabled: true, title: READ_ONLY_HINT }
  ));
}
