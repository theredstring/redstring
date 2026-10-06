/**
 * Names — what a Thing is called, kept short.
 *
 * A Thing's name is a handle; what it says belongs in its description. A
 * small model asked for a step, a goal or a belief writes a sentence, and a
 * sentence as a name is a node as wide as the screen, forever. So the world
 * shortens a long name that reads as a sentence and keeps the whole sentence
 * as the description: nothing is lost, and nothing is that wide.
 *
 * Length alone is not the test. Some names are long and are names: "The
 * Hitchhiker's Guide to the Galaxy", "Second Law of Thermodynamics", a title
 * in quotes. Those are kept as given.
 */

/** Longest name kept as given; anything longer is shortened. */
export const MAX_NAME_WORDS = 6;
/** What a long name is shortened to. */
export const SHORT_NAME_WORDS = 5;

const TRAILING = /^(the|a|an|of|to|and|or|but|with|by|for|in|on|at|from|that|which|causing|making|so|as|is|are|was|were|be|its|their|this|these)$/i;

export const wordsIn = (s) => String(s || '').trim().split(/\s+/).filter(Boolean);

/**
 * Words cut to `max` where a phrase ends: at the last clause break inside the
 * limit, else without dangling little words. "Yeast ferments sugars to produce
 * carbon dioxide gas, causing the" keeps "Yeast ferments sugars to produce
 * carbon dioxide gas".
 */
export function clipWords(words, max) {
  let kept = words.slice(0, max);
  const lastBreak = kept.findLastIndex((w, i) => i < kept.length - 1 && /[,;:.]$/.test(w));
  if (lastBreak >= 1) kept = kept.slice(0, lastBreak + 1);
  while (kept.length > 1 && TRAILING.test(kept.at(-1).replace(/[,;:.]$/, ''))) kept.pop();
  return kept.join(' ').replace(/[,;:.]$/, '');
}

const SMALL = /^(a|an|the|of|to|and|or|for|in|on|at|by|with|from|de|la|le|von|van|der)$/i;
// Words that make a run of words a statement: "is", "makes", "produces"...
const VERB = /^(is|are|was|were|be|been|has|have|had|does|do|did|can|will|would|should|could|may|might|must|makes?|made|causes?|produces?|helps?|needs?|gives?|holds?|keeps?|turns?|leads?|creates?|becomes?|means?|uses?|grows?|feeds?|eats?|forms?|rises?|ferments?|carves?|flows?|seems?|shows?|explains?|lets?|stays?|goes|comes|takes?|puts?|gets?|involves?|includes?|contains?|describes?|affects?|determines?|requires?|consists?|depends?|interacts?|orbits?|travels?|moves?|carries|carry|emits?|absorbs?|surrounds?|protects?|controls?|connects?|supports?)$/i;

/** Whether words carry a verb, as a sentence does: "Gluons are particles". */
export const hasVerb = (text) => wordsIn(String(text || '').replace(/[,;:.!?]/g, '')).some(w => VERB.test(w));

/**
 * Whether a long run of words is a name (a title, a proper name) rather than
 * a sentence: quoted, or Title Case, and not carried by a verb.
 */
export function readsAsName(text) {
  const s = String(text || '').trim();
  if (/^["'“‘].*["'”’]$/.test(s)) return true;
  if (/[.!?]$/.test(s)) return false;
  const words = wordsIn(s.replace(/[,;:]/g, ''));
  const big = words.filter(w => !SMALL.test(w));
  const capitalized = big.filter(w => /^[A-Z0-9]/.test(w)).length;
  const verbs = words.filter(w => VERB.test(w)).length;
  return big.length > 0 && capitalized / big.length >= 0.75 && verbs === 0;
}

/** A name short enough to be one: as given when it is (or when it is a long name), else clipped where a phrase ends. */
export function shortName(name) {
  const words = wordsIn(name);
  if (words.length <= MAX_NAME_WORDS || readsAsName(name)) return words.join(' ');
  return clipWords(words, SHORT_NAME_WORDS);
}

/** The singular of a final English word, roughly: processes → process, berries → berry, rivers → river. */
// Words already singular that end in s ("Gas", "Virus", "Basis") stay; "Gas" read as "ga", and Gas and Gases were two Things.
const PLURAL_OF_S = { gases: 'gas', buses: 'bus', viruses: 'virus', species: 'species', series: 'series' };
const singular = (w) => (PLURAL_OF_S[w] || (/(ss|us|is|as)$/.test(w) ? w : /(ss|x|z|ch|sh|o)es$/.test(w) ? w.slice(0, -2) : /ies$/.test(w) ? `${w.slice(0, -3)}y` : /[^s]s$/.test(w) ? w.slice(0, -1) : w));

/** A name reduced to what makes it the same name: case, articles, punctuation and a final plural ignored. */
export function normalizeName(s) {
  const words = String(s || '').toLowerCase().replace(/^(a|an|the)\s+/, '').replace(/[^a-z0-9 ]/g, '').trim().split(/\s+/);
  if (words.length) words[words.length - 1] = singular(words[words.length - 1]);
  return words.join(' ');
}

/**
 * Words for this place itself (webs, Things, Home, how it is navigated) and
 * for thinking in general. With nothing to think about, a Druid thinks about
 * its own medium: one fresh run made "Home Web", "New web", "Web",
 * "Navigation" and "Contents" in four moments; an earlier one "Web of ideas"
 * and "Web of connections".
 */
// Only words that mean this place and nothing else. Thoughts, ideas, memory,
// the universe, networks are subjects in the world: a Druid asking what
// consciousness is made of was refused "Thoughts".
const MEDIUM = new Set(['redstring', 'web', 'webs', 'thing', 'things', 'node', 'nodes', 'home', 'new', 'my',
  'navigation', 'navigate', 'navigating', 'content', 'contents', 'connection', 'connections', 'link', 'links',
  'graph', 'graphs', 'interconnected', 'description', 'descriptions']);
const FILLER = /^(the|a|an|of|to|and|or|for|in|on|at|by|with|from|its|this|how|what|about|it|is)$/i;

/**
 * Whether a name is only about this place itself: every word is a medium word
 * (or filler), and the person did not use them (`allowed`, lowercased words
 * from what they seeded or said). "Spider Web" and "Memory Foam" are not.
 */
export function aboutTheMedium(name, allowed = new Set()) {
  const words = wordsIn(String(name || '').toLowerCase().replace(/[^a-z\s'-]/g, ' ')).filter(w => !FILLER.test(w));
  if (!words.length) return false;
  return words.every(w => MEDIUM.has(w) || MEDIUM.has(w.replace(/s$/, ''))) && !words.some(w => allowed.has(w) && w !== 'new');
}

/**
 * A subject, from a question asked about it: "What is dark matter?" names
 * "Dark matter". A web named as a question read like a thought, not a place.
 * Other questions only lose the question mark.
 */
export function asSubject(text) {
  // Not its number in a list: "1. Past".
  const t = String(text || '').trim().replace(/[.!?]+$/, '').replace(/^\(?\d+[.):]\s*/, '');
  const m = /^(?:what|who)(?:\s+(?:is|are|was|were)|'s)\s+(?:a\s+|an\s+|the\s+)?(.+)$/i.exec(t);
  // "Understanding Black Hole" is about black holes.
  const out = (m ? m[1] : t).replace(/^(?:understanding|understand|learning about|learn about|studying|study of|the study of)\s+(?:the\s+|a\s+|an\s+)?(?=\S)/i, '')
    // Not how often it is one: "Sometimes Chromium", listed as a part of Nickel.
    .replace(/^(?:sometimes|often|usually|mainly|mostly|also|possibly|primarily|typically|generally|occasionally|rarely)\s+(?=\S)/i, '')
    // Nor how many: "One electron" is the Electron.
    .replace(/^(?:one|two|three|four|five|single|several|many|some|a few|multiple)\s+(?=\S)/i, '')
    // "Love as a whole" is Love.
    .replace(/\s+as\s+a\s+whole$/i, '');
  return out.charAt(0).toUpperCase() + out.slice(1);
}

/** A goal to understand a subject: "Dark matter" → "Understand dark matter"; "DNA" stays "DNA". */
export function understandGoal(subject) {
  const s = asSubject(subject);
  if (/^understand\b/i.test(s)) return s;
  // A whole question is its own goal: "Understand why is the sky blue" is no sentence.
  if (/^(why|how|what|when|where|which|who)\s+(is|are|was|were|do|does|did|can|could|would|will|should|has|have)\b/i.test(s)) return s;
  // "Dark matter" → "dark matter"; one word may be a name (Mars, DNA) and keeps its capital.
  const lowered = /^[A-Z][a-z]*\s/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s;
  return `Understand ${lowered}`;
}

/** Words that are only ever qualities, and endings that usually are. */
const QUALITIES = new Set(['dark', 'unknown', 'mysterious', 'invisible', 'visible', 'big', 'small', 'large', 'hot', 'cold', 'bright', 'strange', 'important', 'complex', 'simple', 'abstract',
  'smooth', 'rough', 'soft', 'hard', 'wet', 'dry', 'warm', 'cool', 'dense', 'thin', 'thick', 'fast', 'slow', 'strong', 'weak', 'heavy',
  'sharp', 'flat', 'round', 'deep', 'shallow', 'mutual', 'tiny', 'huge', 'new', 'old', 'young', 'bitter', 'sweet', 'sour']);
const QUALITY_ENDING = /(al|ous|ive|ic|ible|able|ful|less)$/i;
// Comparatives ("Cooler", "Denser") and "Charged" end like many things do ("Water", "Seed"): only asked.
const COMPARATIVE_ENDING = /(er|est|ed)$/i;

/** Whether a one-word name might be a quality, not a thing: asked of a helper only then. */
export function looksLikeQuality(name) {
  const words = wordsIn(name);
  if (words.length === 2 && /^(more|less|most|least|very)$/i.test(words[0])) return true;
  if (words.length !== 1) return false;
  const w = words[0].toLowerCase();
  return QUALITIES.has(w) || (w.length > 4 && (QUALITY_ENDING.test(w) || COMPARATIVE_ENDING.test(w))) || isPlainlyQuality(w);
}

/** A name that is a quality whatever a model says: "Outermost", "Less dense". */
export function isPlainlyQuality(name) {
  const words = wordsIn(String(name || '').toLowerCase());
  if (words.length === 2 && /^(more|less|most|least|very)$/.test(words[0])) return true;
  return words.length === 1 && words[0].length > 5 && /most$/.test(words[0]);
}

/**
 * An aspect of a Thing rather than a Thing: "Composition", "Origin", "Role of
 * outer layers". Kept from thoughts, these became parts and kinds of nothing.
 */
const ASPECTS = new Set(['composition', 'origin', 'origins', 'role', 'roles', 'function', 'functions', 'purpose', 'nature', 'importance',
  'significance', 'properties', 'property', 'characteristics', 'characteristic', 'features', 'aspects', 'structure', 'relationship',
  'relationships', 'difference', 'differences', 'similarities', 'empty', 'size', 'shape', 'types', 'kinds', 'meaning', 'definition', 'overview',
  // What a thing has or does, asked what it is made of: "Causes, Magnitude,
  // Location, Depth" as the parts of Earthquakes. "Kind of" kept as a Thing.
  'cause', 'causes', 'effect', 'effects', 'factor', 'factors', 'consequences', 'examples', 'example', 'history', 'impact', 'impacts',
  'uses', 'benefits', 'location', 'depth', 'magnitude', 'kind', 'type', 'types', 'sort', 'sorts', 'part', 'parts',
  'component', 'components', 'pattern', 'patterns', 'understanding', 'contrast', 'comparison',
  // "Stage of Absorption": a stage of something, not a stage.
  'stage', 'stages', 'step', 'steps', 'phase', 'phases',
  // Where in something, not a thing there: asked for the parts of Venus's
  // cloud tops, "Layers"; of Layers, "Upper, Middle, Lower"; and a Middle,
  // part of nothing in particular, took a Trunk, a River and the Mid-Atlantic
  // Ridge (The Druid 12, 2026-10-06). "Middle layer" names a thing; "Middle" does not.
  // (Not Back, Side or Top: a back is a body part.)
  'layer', 'layers', 'level', 'levels', 'middle', 'upper', 'lower', 'inner', 'outer', 'inside', 'outside',
  'section', 'sections', 'region', 'regions', 'area', 'areas', 'zone', 'zones',
  'piece', 'pieces', 'element', 'elements', 'portion', 'portions', 'segment', 'segments']);
export function isAspect(name) {
  const words = wordsIn(String(name || '').toLowerCase());
  // "Sun's role", "Earth's composition": an aspect of the one named before it.
  if (words.length >= 2 && /'s$/.test(words[words.length - 2]) && ASPECTS.has(words[words.length - 1])) return true;
  // "How it works", "Its purpose": about some Thing, not one.
  if (words.length >= 2 && /^(how|why|what|when|where|its|their|his|her|our)$/.test(words[0])) return true;
  if (!words.length || !ASPECTS.has(words[0])) return false;
  return words.length === 1 || words[1] === 'of';
}

/** The Thing a name is an aspect of, by its last word: "Up quark structure" → "Up quark". Null otherwise. */
export function aspectOf(name) {
  const words = wordsIn(name);
  if (words.length < 2 || !ASPECTS.has(words[words.length - 1].toLowerCase())) return null;
  return words.slice(0, -1).join(' ');
}

/**
 * A name that is a kind of another by its words: "Up quark" of Quarks,
 * "Fundamental particles" of Particle. Kept inside, they read as parts.
 */
export function sameHead(name, whole) {
  const n = normalizeName(name);
  const w = normalizeName(whole);
  return !!w && n !== w && n.endsWith(` ${w}`);
}

/**
 * A name for what is missing, not for a Thing: "No signal", "No vibration",
 * "Without light". Something defined by a lack has no parts: opened up, "No
 * signal" was made of "No sound" and "No vibration", and "No vibration" of
 * "No motion", four webs down (The Druid 9, 2026-10-05). Hyphened names are
 * Things ("No-fly zone", "Non-Newtonian fluid").
 */
export function isAbsence(name) {
  return /^(no|not|non|without|lack of|absence of)\s+\S/i.test(String(name || '').trim());
}

/** Words for what the Druid does, not Things in the world: "Find" and "Understand", kept from its own thoughts. */
const DOING = new Set(['find', 'understand', 'learn', 'explore', 'know', 'see', 'think', 'study', 'discover', 'investigate', 'observe', 'ask',
  'wonder', 'remember', 'try', 'look', 'examine', 'consider', 'describe', 'explain', 'analyze', 'analyse', 'compare', 'figure', 'search', 'notice', 'fill']);
export function isDoing(name) {
  const words = wordsIn(String(name || '').toLowerCase());
  return words.length === 1 && DOING.has(words[0]);
}
