/**
 * Explanation text for the About section.
 *
 * Kept out of the components so the interface can stay in plain language while
 * the concepts underneath stay reachable. Nothing here says "owl:sameAs" or
 * "skos:exactMatch" — a user confirming a match is authoring those triples, and
 * doesn't need the vocabulary to do it correctly.
 *
 * Every string is as short as it can be and still be true. These sit inside
 * popovers a reader opened for one specific question; a paragraph is a wall to
 * get past, not an answer.
 */

export const ABOUT_INTRO =
  'What other systems call this subject, and where it came from.';

export const IDENTIFIERS_INTRO =
  'Other systems\' names for this subject. The top three always show, even when ' +
  'empty. Search to fill or swap one, and read the grey line: the same word ' +
  'often names a different thing.';

/**
 * One line on purpose. This sits above a list whose length isn't knowable in
 * advance, and every line of preamble is a result pushed out of view.
 */
export const PICKER_INTRO = 'Each description is that system\'s own.';

/** Shown on a standing slot that nothing fills yet. */
export const EMPTY_SLOT_TEXT = 'Not linked';

/**
 * The sameness ladder, in the order it appears in the chooser. `state` matches
 * LINK_STATES in src/formats/linkState.js.
 *
 * Each blurb is one short line. Three rungs read as three rungs; a paragraph
 * under each turns a quick decision into homework, and the label already
 * carries most of the meaning.
 */
export const MATCH_STATES = [
  {
    state: 'matched',
    label: 'Matched Automatically',
    blurb: 'Nobody has checked it.'
  },
  {
    state: 'confirmed',
    label: 'Confirmed',
    blurb: 'You checked it.'
  },
  {
    state: 'same',
    label: 'Same Thing',
    blurb: 'Anything true of one is true of the other.'
  }
];

export const PROVENANCE_INTRO =
  'How this Thing got here, and how its names were found. Anything you made ' +
  'yourself reads as Redstring.';

export const ID_INTRO =
  'Redstring\'s internal handle. It never leaves your universe.';

/** Numeric confidence → a word. The number stays available on hover. */
export const confidenceWord = (value) => {
  if (typeof value !== 'number' || Number.isNaN(value)) return null;
  const pct = value <= 1 ? value * 100 : value;
  if (pct >= 85) return 'high confidence';
  if (pct >= 60) return 'medium confidence';
  return 'low confidence';
};
