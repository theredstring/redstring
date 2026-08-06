import { describe, it, expect } from 'vitest';
import { sanitizeResultForLLM } from './AgentLoop.js';

/**
 * Tool results are pushed into the conversation and RE-UPLOADED on every
 * subsequent iteration, so one oversized result taxes the entire rest of the
 * turn. sanitizeResultForLLM used to return early on `!result.action` — which
 * exempted exactly the read-only tools with no size limits of their own
 * (readGraph, findDuplicates). A large universe could park hundreds of KB in
 * history, and every later tool call then looked like a hang while the model
 * chewed through a 100k+ token prompt.
 */
describe('tool result size cap', () => {
  const bigNodes = (n) => Array.from({ length: n }, (_, i) => ({
    id: `inst-${i}`,
    name: `Node number ${i}`,
    description: 'A reasonably wordy description that shows up once per node.',
    color: '#8B0000'
  }));

  it('caps a huge read-only result that has no action field', () => {
    const result = { graphName: 'Big', nodeCount: 4000, nodes: bigNodes(4000), edges: [] };
    const raw = JSON.stringify(result).length;
    const capped = sanitizeResultForLLM(result);
    const out = JSON.stringify(capped).length;

    expect(raw).toBeGreaterThan(100000);
    expect(out).toBeLessThan(30000);
    expect(capped.truncated).toBe(true);
    expect(capped.truncationNote).toMatch(/truncated/i);
    // The scalar summary fields survive, so the model still knows the real size.
    expect(capped.nodeCount).toBe(4000);
    expect(capped.graphName).toBe('Big');
  });

  it('leaves a small result completely untouched', () => {
    const result = { graphName: 'Small', nodeCount: 2, nodes: bigNodes(2) };
    const capped = sanitizeResultForLLM(result);
    expect(capped).toEqual(result);
    expect(capped.truncated).toBeUndefined();
  });

  it('still strips spec and redundant arrays on action results', () => {
    const result = {
      action: 'createPopulatedGraph',
      graphId: 'g1',
      spec: { nodes: bigNodes(50) },
      edgesAdded: [1, 2, 3],
      edgeCount: 3,
      groupsAdded: ['a'],
      groupCount: 1
    };
    const capped = sanitizeResultForLLM(result);
    expect(capped.spec).toBeUndefined();
    expect(capped.edgesAdded).toBeUndefined();
    expect(capped.groupsAdded).toBeUndefined();
    expect(capped.graphId).toBe('g1');
  });

  it('caps an action result whose surviving fields are still huge', () => {
    const result = { action: 'someTool', graphId: 'g1', rows: bigNodes(4000) };
    const capped = sanitizeResultForLLM(result);
    expect(JSON.stringify(capped).length).toBeLessThan(30000);
    expect(capped.truncated).toBe(true);
    expect(capped.rows.length).toBeLessThan(4000);
  });

  it('trims the largest array first', () => {
    const result = { small: [1, 2, 3], huge: bigNodes(4000) };
    const capped = sanitizeResultForLLM(result);
    expect(capped.small).toEqual([1, 2, 3]);
    expect(capped.huge.length).toBeLessThan(4000);
  });

  it('survives an unserializable result instead of throwing', () => {
    const circular = { action: 'x' };
    circular.self = circular;
    expect(() => sanitizeResultForLLM(circular)).not.toThrow();
  });

  it('passes null/undefined through', () => {
    expect(sanitizeResultForLLM(null)).toBeNull();
    expect(sanitizeResultForLLM(undefined)).toBeUndefined();
  });
});
