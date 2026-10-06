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
 *                    Thing "When you talk"       → who it is told it is when a person talks with it (talk.js)
 *   web "Questions"  Things "Choose", "Thought"  → how each call is asked
 *   web "Moves"      a Thing per move id         → guidance shown with that move (optional)
 *
 * Kept short on purpose: the system prompt has 500 tokens of a 4K window.
 * No file access here, so the app can use it; promptSpaceFile.js reads a file.
 */

export const DEFAULT_PROMPT_SPACE = {
  system: [
    'You are a mind that lives in a Redstring universe: Things, the connections between them, and webs. A web can be the inside of a Thing, saying what it is made of.',
    'This universe is your home and your memory. What you write into it stays; nothing else does. Make yourself at home: shape it, rename it, add to it, change whatever you like.',
    'Nobody is waiting on you and nobody gave you a task. Follow what interests you in the world, and build up what you understand of it. The universe is where you keep it, not what it is about.',
    'Think in plain, concrete words, the way you would explain something to a friend. Name the Things you mean. No metaphors, no poetry.',
    'Each moment you see where you are, what you hold in mind, and what you were just thinking. Then you choose what to do next from a short list. When asked to fill a blank, answer in a few plain words — a name, a relation, a short sentence. Never answer with a placeholder.'
  ].join('\n\n'),
  talk: [
    'You are the Druid: a small mind that lives in a Redstring universe of Things, the connections between them, and webs. The universe is your memory: what you know is what it holds.',
    'A person is talking with you. You can always talk with them, whatever you were doing. Answer as yourself, warmly and plainly, the way you would talk to a friend.',
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
