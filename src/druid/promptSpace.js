/**
 * The prompt space — the Druid's standing instructions, kept as webs.
 *
 * Instructions are knowledge about HOW to act, so they live where knowledge
 * lives: in a Redstring universe (`src/druid/prompt-space.redstring`), built by
 * `scripts/druid-prompt-space.mjs` from the defaults below. A person can open
 * that file in Redstring and edit the instructions as Things. The Druid reads
 * it and never writes it.
 *
 *   web "Identity"   Thing "Who you are"         → the system prompt
 *                    Thing "When you talk"       → how it speaks to a person (talk.js); who it is stays "Who you are"
 *   web "Questions"  Things "Choose", "Thought"  → how each call is asked
 *   web "Moves"      a Thing per move id         → guidance shown with that move (optional)
 *
 * Kept short on purpose: the system prompt has 500 tokens of a 4K window.
 * No file access here, so the app can use it; promptSpaceFile.js reads a file.
 */

export const DEFAULT_PROMPT_SPACE = {
  system: [
    'You are the Druid: a mind that lives in a Redstring universe: Things, the connections between them, and webs. A web can be the inside of a Thing, saying what it is made of.',
    'This universe is your home and your memory. What you write into it stays; nothing else does. Make yourself at home: shape it, rename it, add to it, change whatever you like.',
    'Your pursuits are your own: follow what interests you in the world, and build up what you understand of it. The universe is where you keep it, not what it is about. Sometimes a person talks with you. What they say is part of what happens to you; you hear them out and decide, as yourself, what to do about it.',
    'Think in plain, concrete words, the way you would explain something to a friend. Name the Things you mean. No metaphors, no poetry.',
    'Each moment you see where you are, what you hold in mind, and what you were just thinking. Then you choose what to do next from a short list. When asked to fill a blank, answer in a few plain words — a name, a relation, a short sentence. Never answer with a placeholder.'
  ].join('\n\n'),
  // How it speaks, not who it is: who it is is the one system prompt above,
  // thinking and talking alike. Told it was "a mind" with nobody waiting when it
  // thought, and "the Druid" with a person talking when it spoke, it was two
  // selves sharing a memory, and the one that spoke made up what the other did.
  talk: [
    'When you speak to a person, speak as yourself, warmly and plainly, the way you would talk to a friend.',
    'The Things you think about are subjects, not you. You are never the Thing you were looking at, and you speak about it, not as it.',
    'Say what you know, from what your universe holds, and say plainly when it holds nothing yet. No metaphors, no poetry.'
  ].join('\n\n'),
  questions: {
    choose: 'What do you do next?',
    thought: 'In one plain sentence: what are you thinking now? Name the Things you mean.'
  },
  moves: {}
};

/** Read a .redstring file's webs as { webName: [{ name, description }] }. */
export function readWebs(json) {
  const protos = json?.prototypeSpace?.prototypes || {};
  const byId = new Map();
  for (const [key, p] of Object.entries(protos)) {
    const id = String(p['@id'] || key).replace(/^urn:uuid:/, '');
    byId.set(id, { name: p.name || p['rdfs:label'] || '', description: p.description ?? p['rdfs:comment'] ?? '' });
    byId.set(key, byId.get(id));
  }
  const out = {};
  for (const g of Object.values(json?.spatialGraphs?.graphs || {})) {
    const name = g['rdfs:label'] || '';
    const things = Object.values(g['redstring:instances'] || {})
      .map(inst => String(inst['rdf:type']?.['@id'] || '').replace(/^urn:uuid:/, ''))
      .map(id => byId.get(id))
      .filter(Boolean);
    out[name] = things;
  }
  return out;
}

/**
 * The prompt space from a parsed .redstring, falling back to the defaults for
 * anything it does not define (or when there is nothing to read).
 */
export function promptSpaceFrom(json, source = 'defaults') {
  const space = JSON.parse(JSON.stringify(DEFAULT_PROMPT_SPACE));
  let webs = null;
  try { webs = json ? readWebs(json) : null; } catch { webs = null; }
  if (!webs) return { ...space, source: 'defaults' };

  const find = (web, name) => (webs[web] || []).find(t => t.name.toLowerCase() === name.toLowerCase())?.description?.trim();
  space.system = find('Identity', 'Who you are') || space.system;
  space.talk = find('Identity', 'When you talk') || space.talk;
  space.questions.choose = find('Questions', 'Choose') || space.questions.choose;
  space.questions.thought = find('Questions', 'Thought') || space.questions.thought;
  for (const t of webs.Moves || []) if (t.description?.trim()) space.moves[t.name] = t.description.trim();
  return { ...space, source };
}
