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
const VERB = /^(is|are|was|were|be|been|has|have|had|does|do|did|can|will|would|should|could|may|might|must|makes?|made|causes?|produces?|helps?|needs?|gives?|holds?|keeps?|turns?|leads?|creates?|becomes?|means?|uses?|grows?|feeds?|eats?|forms?|rises?|ferments?|carves?|flows?|seems?|shows?|explains?|lets?|stays?|goes|comes|takes?|puts?|gets?)$/i;

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
const singular = (w) => (/(ss|x|z|ch|sh|o)es$/.test(w) ? w.slice(0, -2) : /ies$/.test(w) ? `${w.slice(0, -3)}y` : /[^s]s$/.test(w) ? w.slice(0, -1) : w);

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
const MEDIUM = new Set(['redstring', 'web', 'webs', 'thing', 'things', 'node', 'nodes', 'home', 'new', 'my', 'navigation', 'navigate', 'navigating',
  'content', 'contents', 'structure', 'structures', 'connection', 'connections', 'connect', 'connecting', 'link', 'links', 'graph', 'graphs',
  'universe', 'network', 'networks', 'idea', 'ideas', 'thought', 'thoughts', 'thinking', 'concept', 'concepts', 'memory', 'working',
  'explore', 'exploring', 'exploration', 'understand', 'understanding', 'place', 'space', 'start', 'starting', 'point', 'first',
  'learn', 'learning', 'knowledge', 'information', 'interconnected', 'relation', 'relations', 'relationship', 'relationships']);
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
  const t = String(text || '').trim().replace(/[.!?]+$/, '');
  const m = /^(?:what|who)(?:\s+(?:is|are|was|were)|'s)\s+(?:a\s+|an\s+|the\s+)?(.+)$/i.exec(t);
  const out = m ? m[1] : t;
  return out.charAt(0).toUpperCase() + out.slice(1);
}

/** A goal to understand a subject: "Dark matter" → "Understand dark matter"; "DNA" stays "DNA". */
export function understandGoal(subject) {
  const s = asSubject(subject);
  if (/^understand\b/i.test(s)) return s;
  // "Dark matter" → "dark matter"; one word may be a name (Mars, DNA) and keeps its capital.
  const lowered = /^[A-Z][a-z]*\s/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s;
  return `Understand ${lowered}`;
}
