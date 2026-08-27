/**
 * Explanation text for the About section.
 *
 * Kept out of the components so the interface can stay in plain language while
 * the concepts underneath stay reachable. Nothing here says "owl:sameAs" or
 * "skos:exactMatch" — a user confirming a match is authoring those triples, and
 * doesn't need the vocabulary to do it correctly.
 */

export const ABOUT_INTRO =
  'What other systems call this same subject, and where those names came from. ' +
  'Redstring uses these to line your thinking up with the wider world, so a ' +
  'thing you wrote down can be recognised as the same thing someone else wrote down.';

export const IDENTIFIERS_INTRO =
  'Each row is another system\'s name for this subject. Redstring finds some of ' +
  'these on its own; you can add or remove any of them.';

/**
 * The sameness ladder, in the order it appears in the chooser. `state` matches
 * LINK_STATES in src/formats/linkState.js.
 */
export const MATCH_STATES = [
  {
    state: 'matched',
    label: 'Matched automatically',
    blurb: 'Redstring found this and it looks like the same subject, but nobody has checked.'
  },
  {
    state: 'confirmed',
    label: 'Confirmed',
    blurb: 'You looked at this and it\'s right.'
  },
  {
    state: 'same',
    label: 'Same thing',
    blurb: 'This name and this thing are one and the same. Anything true of one is true of the other.'
  }
];

export const MATCH_STATES_INTRO =
  'How sure you are that this name refers to this same thing. It matters when ' +
  'your work is shared or merged: a guess and a certainty travel differently.';

export const PROVENANCE_INTRO =
  'Where this thing came from, and how these names were found. This is the ' +
  'evidence behind the rows above.';

export const ID_INTRO =
  'Redstring\'s own internal handle for this thing. It never leaves your ' +
  'universe and is only useful for debugging.';

/** Numeric confidence → a word. The number stays available on hover. */
export const confidenceWord = (value) => {
  if (typeof value !== 'number' || Number.isNaN(value)) return null;
  const pct = value <= 1 ? value * 100 : value;
  if (pct >= 85) return 'high confidence';
  if (pct >= 60) return 'medium confidence';
  return 'low confidence';
};
