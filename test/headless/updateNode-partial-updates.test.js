// @vitest-environment node
/**
 * updateNode with only some fields set, over the whole MCP path:
 *
 *   store → buildBridgeState → (JSON, as POSTed to /api/bridge/state)
 *     → MCP getRealRedstringState + toPlainState → updateNode tool
 *     → pending action { action, params: [result] } (JSON, through the bridge)
 *     → BridgeClient's envelope → applyToolResultToStore → store
 *
 * Regression for a 2026-10-02 report that description-only edits came back
 * `updated: true` but did not persist, while the same edit with `name` set
 * did. Each case changes one field and checks the stored prototype, and that
 * the fields it did not name are left alone.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { createHeadlessStore, __resetHeadlessStoreCache } from '../../src/headless/createHeadlessStore.js';

const GRAPH_ID = 'g-partial-updates';

let useGraphStore;
let applyToolResultToStore;
let buildBridgeState;
let executeTool;

beforeAll(async () => {
  __resetHeadlessStoreCache();
  // The applier statically imports graphStore, so it loads after the shim.
  ({ useGraphStore } = await createHeadlessStore());
  ({ applyToolResultToStore } = await import('../../src/services/toolResultApplier.js'));
  ({ buildBridgeState } = await import('../../src/services/bridgeStateSerializer.js'));
  ({ executeTool } = await import('../../src/wizard/tools/index.js'));

  applyToolResultToStore('createGraph', { action: 'createGraph', graphId: GRAPH_ID, graphName: 'Portfolio Service' });
  for (const name of ['Portal', 'Stripe Webhooks', 'Founding Client Pricing']) {
    applyToolResultToStore('createNode', {
      action: 'createNode', graphId: GRAPH_ID, name, color: '#4a9950', description: `old ${name}`, enrich: false
    });
  }
});

/**
 * The state the MCP server hands its tools: the bridge payload after a JSON
 * round trip, rebuilt the way getRealRedstringState and toPlainState in
 * redstring-mcp-server.js do (instances arrive as an object, leave as an array).
 */
function mcpGraphState() {
  const data = JSON.parse(JSON.stringify(buildBridgeState(useGraphStore.getState(), { fileStatus: null })));
  return {
    graphs: (data.graphs || []).map((graph) => ({
      ...graph,
      instances: Object.values(graph.instances || {}),
      groups: Array.isArray(graph.groups) ? graph.groups : []
    })),
    nodePrototypes: data.nodePrototypes || [],
    edges: data.graphEdges || [],
    activeGraphId: data.activeGraphId,
    openGraphIds: data.openGraphIds || []
  };
}

/** Run updateNode as an MCP call and apply it the way BridgeClient does. */
async function updateNodeViaMcp(args) {
  const result = await executeTool('updateNode', args, mcpGraphState(), 'mcp-test', () => {});
  const pending = JSON.parse(JSON.stringify({ action: result.action, params: [result] }));
  applyToolResultToStore(pending.action, { action: pending.action, ...pending.params[0] }, 'pa-test');
  return result;
}

const protoNamed = (name) =>
  Array.from(useGraphStore.getState().nodePrototypes.values()).filter((p) => p.name === name);

describe('updateNode partial updates over the MCP bridge path', () => {
  it('a description-only update persists to the prototype', async () => {
    const result = await updateNodeViaMcp({
      nodeName: 'Portal', description: 'Accounts, content editing, uploads.', targetGraphId: GRAPH_ID
    });

    expect(result).toMatchObject({ updated: true, updates: { description: 'Accounts, content editing, uploads.' } });
    expect(result.updates).not.toHaveProperty('name');

    const protos = protoNamed('Portal');
    expect(protos).toHaveLength(1);
    expect(protos[0].description).toBe('Accounts, content editing, uploads.');
    expect(protos[0].color).toBe('#4a9950');
  });

  it('a description-only update still persists when the model fills unused fields with ""', async () => {
    // LLMClient sends every field as required, so models pass "" for the rest.
    await updateNodeViaMcp({
      nodeName: 'Stripe Webhooks', name: '', color: '', description: 'Signed events, handled once each.', targetGraphId: GRAPH_ID
    });

    const [proto] = protoNamed('Stripe Webhooks');
    expect(proto.description).toBe('Signed events, handled once each.');
    expect(proto.color).toBe('#4a9950');
  });

  it('a color-only update persists and leaves the description alone', async () => {
    await updateNodeViaMcp({ nodeName: 'Founding Client Pricing', color: '#A72706', targetGraphId: GRAPH_ID });

    const [proto] = protoNamed('Founding Client Pricing');
    expect(proto.color).toBe('#A72706');
    expect(proto.description).toBe('old Founding Client Pricing');
  });

  it('the bridge state the next MCP read sees carries the new description', async () => {
    await updateNodeViaMcp({ nodeName: 'Portal', description: 'Second edit.', targetGraphId: GRAPH_ID });

    const proto = mcpGraphState().nodePrototypes.find((p) => p.name === 'Portal');
    expect(proto.description).toBe('Second edit.');
  });
});
