/**
 * The real store, headless, with a fresh empty universe per test, and a
 * world (src/druid/world.js) wired to the real wizard tools and applier.
 */
import { vi } from 'vitest';
import { createHeadlessStore } from '../../../src/headless/createHeadlessStore.js';

let cached = null;

async function boot() {
  if (cached) return cached;
  const { useGraphStore } = await createHeadlessStore();
  const { applyToolResultToStore, configureToolResultApplier } = await import('../../../src/services/toolResultApplier.js');
  const { executeTool } = await import('../../../src/wizard/tools/index.js');
  const { createWorld } = await import('../../../src/druid/world.js');
  configureToolResultApplier({});
  cached = { useGraphStore, applyToolResultToStore, executeTool, createWorld };
  return cached;
}

const emptyUniverse = () => ({
  graphs: new Map(),
  nodePrototypes: new Map(),
  edges: new Map(),
  openGraphIds: [],
  activeGraphId: null,
  activeDefinitionNodeId: null,
  expandedGraphIds: new Set(),
  rightPanelTabs: [{ type: 'home', isActive: true }],
  savedNodeIds: new Set(),
  savedGraphIds: new Set(),
  showConnectionNames: true
});

/** Silence the store's and tools' narration for the duration of a test file. */
export function quiet() {
  for (const k of ['log', 'warn', 'error', 'info', 'debug']) vi.spyOn(console, k).mockImplementation(() => {});
}

/** A fresh universe and a world over it. */
export async function freshWorld() {
  const b = await boot();
  b.useGraphStore.getState().loadUniverseFromFile(emptyUniverse());
  const world = b.createWorld({
    store: b.useGraphStore,
    executeTool: b.executeTool,
    applyToolResult: (name, result, id, cid) => b.applyToolResultToStore(name, result, id, cid, { confirmed: true })
  });
  return { world, store: b.useGraphStore };
}

/** Build a small universe from a spec (the lab's builder: webs, things, links, insides). */
export { buildUniverse } from '../../../src/druid/lab/scenarios.js';
