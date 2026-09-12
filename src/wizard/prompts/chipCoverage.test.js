import { describe, it, expect, vi, beforeEach } from 'vitest';

// A minimal but real-shaped store: two Things with an edge between them, sitting
// in one Web. Enough for every builder to produce a full prompt rather than bail.
const proto = (id, name, extra = {}) => ({ id, name, description: `${name} desc`, ...extra });

const nodePrototypes = new Map([
  ['p-jotun', proto('p-jotun', 'Jotunheim')],
  ['p-midgard', proto('p-midgard', 'Midgard')],
  ['p-realm', proto('p-realm', 'Realm')],
  ['base-connection-prototype', proto('base-connection-prototype', 'Connection')]
]);

const edge = {
  id: 'e-1',
  sourceId: 'i-jotun',
  destinationId: 'i-midgard',
  typeNodeId: 'base-connection-prototype',
  directionality: { arrowsToward: new Set(['i-midgard']) }
};

const graph = {
  id: 'g-1',
  name: 'Norse Cosmology',
  description: 'The nine realms',
  instances: new Map([
    ['i-jotun', { id: 'i-jotun', prototypeId: 'p-jotun' }],
    ['i-midgard', { id: 'i-midgard', prototypeId: 'p-midgard' }]
  ]),
  edgeIds: ['e-1'],
  edges: [edge],
  definingNodeIds: []
};

const state = {
  activeGraphId: 'g-1',
  graphs: new Map([['g-1', graph]]),
  nodePrototypes,
  edges: new Map([['e-1', edge]])
};

vi.mock('../../store/graphStore.js', () => ({
  default: { getState: () => state }
}));

const { SURFACES, INTENTS } = await import('./intents.js');
const { CHIP_TITLES } = await import('../../components/wizard/WizardActionChip.jsx');
const prompts = await import('./intentPrompts.js');
const { buildWizardConnectionPrompt } = await import('./connectionPrompt.js');
const { buildWizardNodeDefinitionPrompt } = await import('./thingPrompt.js');
const { buildWizardAbstractionPrompt } = await import('./ladderPrompt.js');
const { buildWizardGrowGraphPrompt } = await import('./webPrompt.js');

const jotun = nodePrototypes.get('p-jotun');

/**
 * Every intent, mapped to the call NodeCanvas.runWizardIntent actually makes for
 * it. If an intent is added without a build path, the coverage test below fails
 * rather than the chip silently going missing at runtime.
 */
const BUILD_FOR_INTENT = {
  'define-components': () => buildWizardNodeDefinitionPrompt(jotun, {}),
  'connect-into-web': () => prompts.buildConnectThingPrompt(jotun),
  'fill-in-details': () => prompts.buildFillDetailsPrompt(jotun),
  'thing-ladder': () => buildWizardAbstractionPrompt(jotun, 'Generalization Axis', {}),
  'explain-thing': () => prompts.buildExplainThingPrompt(jotun),
  'thing-freetext': () => prompts.buildFreeTextPrompt(SURFACES.THING, { prototype: jotun }, 'why is this here?'),
  'refine-connection': () => buildWizardConnectionPrompt([edge], {}),
  'connection-gaps': () => prompts.buildConnectionGapsPrompt([edge]),
  'explain-connection': () => prompts.buildExplainConnectionPrompt([edge]),
  'connection-freetext': () => prompts.buildFreeTextPrompt(SURFACES.CONNECTION, { edges: [edge] }, 'is this right?'),
  'grow-web': () => buildWizardGrowGraphPrompt({}),
  'summarize-web': () => prompts.buildSummarizeWebPrompt(),
  'audit-web': () => prompts.buildAuditWebPrompt(),
  'web-freetext': () => prompts.buildFreeTextPrompt(SURFACES.WEB, {}, 'what is missing?'),
  'ladder-build': () => buildWizardAbstractionPrompt(jotun, 'Generalization Axis', {})
};

describe('every intent produces a working conversation chip', () => {
  it('covers every registered intent', () => {
    const missing = INTENTS.map(i => i.id).filter(id => !BUILD_FOR_INTENT[id]);
    expect(missing, `intents with no build path: ${missing.join(', ')}`).toEqual([]);
  });

  INTENTS.forEach((intent) => {
    it(`${intent.id} → a chip`, () => {
      const built = BUILD_FOR_INTENT[intent.id]?.();

      // The chip only renders when sendWizardAsk sees a summary — no summary
      // means the raw multi-hundred-line prompt shows up as the user's message.
      expect(built, `${intent.id} built nothing`).toBeTruthy();
      expect(built.message, `${intent.id} has no prompt`).toBeTruthy();
      expect(built.summary, `${intent.id} has no summary, so no chip renders`).toBeTruthy();
      expect(built.action, `${intent.id} has no action`).toBeTruthy();

      // The action the builder stamps has to be the one the registry declares,
      // or the chip title lookup and the instruction dedupe both miss.
      expect(built.action, `${intent.id}: builder action does not match the registry`)
        .toBe(intent.action);

      expect(CHIP_TITLES[built.action], `${intent.id} renders the generic fallback`).toBeTruthy();
    });
  });
});

describe('chip summaries stay short enough to read', () => {
  INTENTS.forEach((intent) => {
    it(`${intent.id} summary is a line, not a prompt`, () => {
      const built = BUILD_FOR_INTENT[intent.id]?.();
      expect(built.summary.length).toBeLessThan(120);
      expect(built.summary).not.toContain('\n');
      // The whole point of the chip: the rich prompt goes to the model, never
      // into the transcript.
      expect(built.summary.length).toBeLessThan(built.message.length);
    });
  });
});
