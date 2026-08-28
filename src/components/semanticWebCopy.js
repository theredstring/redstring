/**
 * Explanation text for the Semantic Web section.
 *
 * Companion to panel/aboutCopy.js, and split from it for the same reason: the
 * strings live outside the components so the interface can stay short while the
 * concepts underneath stay reachable.
 *
 * The difference in register is deliberate. About never names a predicate,
 * because a user confirming a match doesn't need the vocabulary to do it
 * correctly. Here the vocabulary IS the subject, so these say what the terms
 * mean rather than hiding them.
 */

export const RDF_SCHEMA_INTRO =
  'Your name and description, under the standard names other tools read on ' +
  'export. Nothing to fill in.';

export const CLASSIFICATION_INTRO =
  'What other vocabularies call this kind of thing, so a tool that has never ' +
  'seen your universe knows what it is looking at. The primary type itself is ' +
  'the button under the title.';
