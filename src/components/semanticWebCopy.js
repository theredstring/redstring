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
  'The two facts every shared vocabulary expects about a thing: its name and ' +
  'its description. Redstring keeps them in step with what you typed above, so ' +
  'there is nothing to fill in here. They appear under their standard names ' +
  'because that is how other tools will read them when you export.';

export const CLASSIFICATION_INTRO =
  'What other vocabularies call this KIND of thing. A Thing typed as Person ' +
  'can also be declared the same kind as schema:Person and foaf:Person, which ' +
  'lets a tool that has never seen your universe still know what it is looking ' +
  'at. The primary type is set with the type button under the title; these are ' +
  'the outside equivalents of it.';
