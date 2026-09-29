// @vitest-environment node
/**
 * The Wizard end to end, without spending a token.
 *
 * A scripted model (fakeProvider.js) answers at the network boundary in each
 * provider's real wire format. Everything between that and the store is the
 * real code: runWizardInProcess → AgentLoop → LLMClient's SSE parsers → tools
 * → toolResultApplier → graphStore. The graph state handed to each ask is built
 * from the store the way LeftAIView builds it, so a second ask sees what the
 * first one made.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { createHeadlessStore, __resetHeadlessStoreCache } from '../../src/headless/createHeadlessStore.js';
import { installFakeProvider, transcriptProblems } from './fakeProvider.js';

let useGraphStore;
let applyToolResultToStore;
let runWizardInProcess;
let provider;

beforeAll(async () => {
  __resetHeadlessStoreCache();
  ({ useGraphStore } = await createHeadlessStore());
  ({ applyToolResultToStore } = await import('../../src/services/toolResultApplier.js'));
  ({ runWizardInProcess } = await import('../../src/wizard/runWizardInProcess.js'));
  // The loop and the applier narrate to the console; keep test output readable.
  for (const k of ['log', 'warn', 'error', 'info', 'debug']) vi.spyOn(console, k).mockImplementation(() => {});
});

afterEach(() => provider?.restore());

const toArray = (m) => (m instanceof Map ? Array.from(m.values()) : Array.isArray(m) ? m : Object.values(m || {}));

/** The agent's view of the store, shaped as LeftAIView builds it. */
function graphStateFromStore() {
  const st = useGraphStore.getState();
  const graphs = Array.from(st.graphs.values());
  const protoIds = new Set();
  const edgeIds = new Set();
  for (const g of graphs) {
    for (const inst of toArray(g.instances)) protoIds.add(inst.prototypeId);
    for (const id of g.edgeIds || []) {
      edgeIds.add(id);
      for (const d of st.edges.get(id)?.definitionNodeIds || []) protoIds.add(d);
    }
  }
  return {
    graphs: graphs.map(g => ({
      id: g.id, name: g.name, instances: toArray(g.instances), edgeIds: g.edgeIds || [],
      definingNodeIds: g.definingNodeIds || [], groups: toArray(g.groups)
    })),
    nodePrototypes: [...protoIds].map(id => st.nodePrototypes.get(id)).filter(Boolean).map(p => ({
      id: p.id, name: p.name || '', color: p.color || '', description: p.description || '',
      definitionGraphIds: p.definitionGraphIds || []
    })),
    edges: [...edgeIds].map(id => st.edges.get(id)).filter(Boolean).map(e => ({
      id: e.id, sourceId: e.sourceId, destinationId: e.destinationId,
      definitionNodeIds: e.definitionNodeIds || [], type: e.type || ''
    })),
    activeGraphId: st.activeGraphId || null,
    openGraphIds: [...(st.openGraphIds || [])]
  };
}

/** One ask, applied to the store as the panel applies it. */
/**
 * Each provider as a user would configure it. `local` and `custom` carry their
 * own server URL; the hosted services are reached with no endpoint set, which is
 * what exercises the per-service default.
 */
const PROVIDERS = {
  openrouter: { provider: 'openrouter' },
  anthropic: { provider: 'anthropic' },
  openai: { provider: 'openai' },
  google: { provider: 'google' },
  local: { provider: 'local', endpoint: 'http://localhost:11434/v1/chat/completions' },
  custom: { provider: 'together', endpoint: 'https://llm.example.test/v1/chat/completions' }
};
const WIRE = { openrouter: 'openai', anthropic: 'anthropic', openai: 'openai', google: 'google', local: 'openai', custom: 'openai' };

async function ask(format, message, script, { apiConfig = {}, signal, onEvent } = {}) {
  provider = installFakeProvider(WIRE[format], script);
  const events = [];
  let thrown = null;
  try {
    for await (const e of runWizardInProcess({
      message,
      graphState: graphStateFromStore(),
      apiKey: 'sk-test-not-a-key',
      apiConfig: { ...PROVIDERS[format], model: 'scripted', modelTier: 'large', ...apiConfig },
      signal
    })) {
      events.push(e);
      if (e.type === 'tool_result' && !e.result?.cancelled) applyToolResultToStore(e.name, e.result, e.id, 'conv-test');
      onEvent?.(e);
    }
  } catch (err) {
    thrown = err;
  }
  return {
    events,
    thrown,
    requests: provider.model,
    reply: events.filter(e => e.type === 'response').map(e => e.content).join('').trim(),
    end: events.find(e => e.type === 'done' && e.reason)?.reason,
    problems: provider.model.flatMap((r, i) => transcriptProblems(WIRE[format], r.body).map(p => `request ${i}: ${p}`))
  };
}

const findGraph = (name) => Array.from(useGraphStore.getState().graphs.values()).filter(g => g.name === name).pop();
const namesIn = (graph) => toArray(graph.instances).map(i => useGraphStore.getState().nodePrototypes.get(i.prototypeId)?.name);
const edgesIn = (graph) => (graph.edgeIds || []).map(id => {
  const st = useGraphStore.getState();
  const e = st.edges.get(id);
  const nameOf = (instId) => st.nodePrototypes.get(toArray(graph.instances).find(i => i.id === instId)?.prototypeId)?.name;
  return `${nameOf(e.sourceId)}→${nameOf(e.destinationId)}`;
});

const PLANETS = ['Sun', 'Mercury', 'Venus', 'Earth', 'Mars'];
const buildPlanets = (graphName) => [
  { text: "I'll build that.", tools: [{ id: 'tu_build', name: 'createPopulatedGraph', args: {
    name: graphName,
    description: 'The rocky planets and the star they orbit.',
    nodes: PLANETS.map(n => ({ name: n, description: `${n}.`, type: n === 'Sun' ? 'Star' : 'Planet' })),
    edges: PLANETS.slice(1).map(n => ({ source: n, target: 'Sun', type: 'Orbits' }))
  } }] },
  { text: `Built ${graphName}: the Sun and the four rocky planets, each orbiting it.` }
];

describe.each(Object.keys(PROVIDERS))('Wizard end to end over %s', (format) => {
  it('answers a plain question with text, in one request', async () => {
    const r = await ask(format, 'What can you do?', [{ text: 'I can build and edit graphs.' }]);
    expect(r.reply).toBe('I can build and edit graphs.');
    expect(r.end).toBe('model_done');
    expect(r.requests).toHaveLength(1);
  });

  it('builds a graph the store actually contains, then edits it on a follow-up ask', async () => {
    const graphName = `Inner Planets (${format})`;
    const first = await ask(format, 'Build a graph of the inner planets', buildPlanets(graphName));

    expect(first.thrown).toBeNull();
    expect(first.problems).toEqual([]);
    expect(first.reply).toContain(`Built ${graphName}`);
    expect(first.requests).toHaveLength(2);

    const graph = findGraph(graphName);
    expect(graph).toBeTruthy();
    expect(namesIn(graph).sort()).toEqual([...PLANETS].sort());
    expect(edgesIn(graph).sort()).toEqual(['Earth→Sun', 'Mars→Sun', 'Mercury→Sun', 'Venus→Sun']);

    // Second ask sees the first one's work through the store, and resolves by
    // name: the agent never learns the store's real ids.
    useGraphStore.getState().setActiveGraph?.(graph.id);
    const second = await ask(format, 'Add the Moon orbiting Earth', [
      { tools: [
        { id: 'tu_moon', name: 'createNode', args: { name: 'Moon', description: "Earth's satellite.", color: '#888888' } },
        { id: 'tu_orbit', name: 'createEdge', args: { sourceId: 'Moon', targetId: 'Earth', type: 'Orbits' } }
      ] },
      { text: 'Added the Moon, orbiting Earth.' }
    ]);

    expect(second.problems).toEqual([]);
    expect(second.reply).toBe('Added the Moon, orbiting Earth.');
    const after = findGraph(graphName);
    expect(namesIn(after)).toContain('Moon');
    expect(edgesIn(after)).toContain('Moon→Earth');
    // The follow-up ask carried the planets in its context.
    expect(JSON.stringify(second.requests[0].body)).toContain('Mercury');
  });

  it('keeps every transcript valid across parallel calls, a failing tool and an unknown tool', async () => {
    const r = await ask(format, 'Do several things', [
      { tools: [
        { id: 'tu_a', name: 'createNode', args: { name: 'Alpha', description: 'a' } },
        { id: 'tu_b', name: 'noSuchTool', args: {} },
        { id: 'tu_c', name: 'updateNode', args: { name: 'Nothing By This Name', color: '#000000' } }
      ] },
      { text: 'Done what I could.' }
    ]);
    expect(r.problems).toEqual([]);
    expect(r.events.filter(e => e.type === 'tool_result')).toHaveLength(3);
    expect(r.reply).toBe('Done what I could.');
  });

  it('stops on the first request when the key is rejected, with a readable error', async () => {
    const r = await ask(format, 'hello', [{ status: 401, errorBody: '{"error":{"message":"invalid api key"}}' }]);
    expect(r.requests).toHaveLength(1);
    expect(r.events.find(e => e.type === 'error')?.message).toMatch(/401/);
  });

  it('stops making requests once the user presses stop', async () => {
    const controller = new AbortController();
    let results = 0;
    const script = (i) => ({ tools: [{ id: `tu_${i}`, name: 'createNode', args: { name: `Stop Test ${i}`, description: 'x' } }] });
    const r = await ask(format, 'Keep adding nodes', script, {
      signal: controller.signal,
      onEvent: (e) => { if (e.type === 'tool_result' && ++results === 2) controller.abort(); }
    });
    const sent = r.requests.length;
    await new Promise(res => setTimeout(res, 100));
    expect(r.end).toBe('aborted');
    expect(provider.model.length).toBe(sent);
    expect(sent).toBeLessThanOrEqual(3);
  });

  it('caps a runaway ask by its token budget', async () => {
    const script = (i) => ({ promptTokens: 20000, tools: [{ id: `tu_${i}`, name: 'searchNodes', args: { query: `thing ${i}` } }] });
    const r = await ask(format, 'search forever', script, { apiConfig: { settings: { maxAskTokens: 100000 } } });
    expect(r.end).toBe('token_budget');
    expect(r.requests.length).toBeLessThanOrEqual(6);
  });
});

describe('Wizard respects what is already there', () => {
  it('re-mentioning an existing node fills blanks but never overwrites it', async () => {
    await ask('openrouter', 'Build a small graph', [
      { tools: [{ id: 'tu_g', name: 'createPopulatedGraph', args: {
        name: 'Respect Test', description: 'x',
        nodes: [{ name: 'Earth', description: 'Third planet from the Sun.', color: '#123456' }, { name: 'Luna', description: '' }]
      } }] },
      { text: 'Done.' }
    ]);
    const graph = findGraph('Respect Test');
    useGraphStore.getState().setActiveGraph?.(graph.id);

    const r = await ask('openrouter', 'Add Earth and Luna', [
      { tools: [
        { id: 'tu_e', name: 'createNode', args: { name: 'Earth', description: 'A duplicate-trap description.', color: '#E2BBE9' } },
        { id: 'tu_l', name: 'createNode', args: { name: 'Luna', description: "Earth's moon." } }
      ] },
      { text: 'Done.' }
    ]);
    expect(r.problems).toEqual([]);

    const st = useGraphStore.getState();
    const after = findGraph('Respect Test');
    expect(namesIn(after).filter(n => n === 'Earth')).toHaveLength(1);
    const protoOf = (name) => [...st.nodePrototypes.values()].filter(p => p.name === name).pop();
    expect(protoOf('Earth').description).toBe('Third planet from the Sun.');
    expect(protoOf('Earth').color).toBe('#123456');
    // A blank description is filled.
    expect(protoOf('Luna').description).toBe("Earth's moon.");
  });

  it('editing or deleting a node that is not there says so instead of claiming success', async () => {
    const before = useGraphStore.getState().nodePrototypes.size;
    const r = await ask('openrouter', 'Recolor Pluto, then delete Pluto', [
      { tools: [
        { id: 'tu_u', name: 'updateNode', args: { nodeName: 'Pluto', color: '#000000' } },
        { id: 'tu_d', name: 'deleteNode', args: { nodeName: 'Pluto' } }
      ] },
      { text: 'There is no Pluto here.' }
    ]);
    const results = Object.fromEntries(r.events.filter(e => e.type === 'tool_result').map(e => [e.name, e.result]));
    expect(results.updateNode).toMatchObject({ updated: false, notFound: true });
    expect(results.deleteNode).toMatchObject({ deleted: false, notFound: true });
    expect(useGraphStore.getState().nodePrototypes.size).toBe(before);
    // What the model read carries the honest result.
    expect(JSON.stringify(r.requests[1].body)).toContain('nothing was updated');
  });
});
