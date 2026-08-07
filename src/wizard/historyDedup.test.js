import { describe, it, expect } from 'vitest';
import { dedupeHistory, dedupKeyFor, SUPERSEDABLE_TOOLS } from './historyDedup.js';

const toolMsg = (name, id, content, key) => ({
  role: 'tool',
  tool_call_id: id,
  content,
  _toolName: name,
  _dedupKey: key
});

describe('dedupKeyFor', () => {
  it('keys on the resolved graphId so different arg spellings collapse together', () => {
    const a = dedupKeyFor('readGraph', {}, { graphId: 'g1' });
    const b = dedupKeyFor('readGraph', { targetGraphId: 'Cell' }, { graphId: 'g1' });
    const c = dedupKeyFor('readGraph', { targetGraphId: 'g1' }, { graphId: 'g1' });
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('keeps different graphs apart', () => {
    expect(dedupKeyFor('readGraph', {}, { graphId: 'g1' }))
      .not.toBe(dedupKeyFor('readGraph', {}, { graphId: 'g2' }));
  });

  it('falls back to arguments when the result carries no identifier', () => {
    const a = dedupKeyFor('search', { query: 'cell' }, { hits: [] });
    const b = dedupKeyFor('search', { query: 'cell' }, { hits: [1] });
    const c = dedupKeyFor('search', { query: 'nucleus' }, { hits: [] });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  // A census and a full read are not substitutes for each other, even on the
  // same graph.
  it('separates modes of the same tool', () => {
    expect(dedupKeyFor('inspectWorkspace', { mode: 'map' }, { graphId: 'g1' }))
      .not.toBe(dedupKeyFor('inspectWorkspace', { mode: 'graph' }, { graphId: 'g1' }));
  });

  // Two identical expandGraph calls are two real mutations, not one read repeated.
  it('refuses to key mutating tools', () => {
    expect(dedupKeyFor('expandGraph', { nodes: [] }, { graphId: 'g1' })).toBeNull();
    expect(dedupKeyFor('createNode', { name: 'X' }, {})).toBeNull();
  });

  it('excludes planTask and askMultipleChoice from the eligible set', () => {
    expect(SUPERSEDABLE_TOOLS.has('planTask')).toBe(false);
    expect(SUPERSEDABLE_TOOLS.has('askMultipleChoice')).toBe(false);
  });

  it('gives up rather than throwing on circular arguments', () => {
    const circular = {};
    circular.self = circular;
    expect(dedupKeyFor('search', circular, {})).toBeNull();
  });
});

describe('dedupeHistory', () => {
  const big = JSON.stringify({ nodes: Array.from({ length: 200 }, (_, i) => `node-${i}`) });

  it('keeps the newest result and stubs the older ones', () => {
    const msgs = [
      { role: 'system', content: 'sys' },
      toolMsg('readGraph', 't1', big, 'readGraph|g:g1'),
      { role: 'assistant', content: 'working' },
      toolMsg('readGraph', 't2', big, 'readGraph|g:g1')
    ];
    const { messages, supersededCount, reclaimedTokens } = dedupeHistory(msgs);

    expect(supersededCount).toBe(1);
    expect(reclaimedTokens).toBeGreaterThan(0);
    expect(JSON.parse(messages[1].content).superseded).toBe(true);
    expect(messages[3].content).toBe(big); // newest survives verbatim
  });

  // Deleting the message outright would orphan the assistant's tool_use block,
  // which providers reject.
  it('leaves a tool message in place rather than removing it', () => {
    const msgs = [
      toolMsg('readGraph', 't1', big, 'readGraph|g:g1'),
      toolMsg('readGraph', 't2', big, 'readGraph|g:g1')
    ];
    const { messages } = dedupeHistory(msgs);
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('tool');
    expect(messages[0].tool_call_id).toBe('t1');
  });

  it('does not touch results with different keys', () => {
    const msgs = [
      toolMsg('readGraph', 't1', big, 'readGraph|g:g1'),
      toolMsg('readGraph', 't2', big, 'readGraph|g:g2')
    ];
    const { messages, supersededCount } = dedupeHistory(msgs);
    expect(supersededCount).toBe(0);
    expect(messages[0].content).toBe(big);
    expect(messages[1].content).toBe(big);
  });

  it('leaves unkeyed (mutating) results alone', () => {
    const msgs = [
      toolMsg('expandGraph', 't1', big, null),
      toolMsg('expandGraph', 't2', big, null)
    ];
    const { messages, supersededCount } = dedupeHistory(msgs);
    expect(supersededCount).toBe(0);
    expect(messages.every(m => m.content === big)).toBe(true);
  });

  it('attributes reclaimed tokens to the tool that caused them', () => {
    const msgs = [
      toolMsg('readGraph', 't1', big, 'readGraph|g:g1'),
      toolMsg('inspectWorkspace', 't2', big, 'inspectWorkspace|g:g1'),
      toolMsg('readGraph', 't3', big, 'readGraph|g:g1'),
      toolMsg('inspectWorkspace', 't4', big, 'inspectWorkspace|g:g1')
    ];
    const { byTool } = dedupeHistory(msgs);
    expect(byTool.readGraph).toBeGreaterThan(0);
    expect(byTool.inspectWorkspace).toBeGreaterThan(0);
  });

  it('is idempotent — a second pass reclaims nothing more', () => {
    const msgs = [
      toolMsg('readGraph', 't1', big, 'readGraph|g:g1'),
      toolMsg('readGraph', 't2', big, 'readGraph|g:g1'),
      toolMsg('readGraph', 't3', big, 'readGraph|g:g1')
    ];
    const first = dedupeHistory(msgs);
    expect(first.supersededCount).toBe(2);
    const second = dedupeHistory(first.messages);
    expect(second.supersededCount).toBe(0);
    expect(second.reclaimedTokens).toBe(0);
  });

  it('does not mutate the input', () => {
    const msgs = [
      toolMsg('readGraph', 't1', big, 'readGraph|g:g1'),
      toolMsg('readGraph', 't2', big, 'readGraph|g:g1')
    ];
    const snapshot = JSON.parse(JSON.stringify(msgs));
    dedupeHistory(msgs);
    expect(msgs).toEqual(snapshot);
  });

  it('handles an empty or missing conversation', () => {
    expect(dedupeHistory([]).messages).toEqual([]);
    expect(dedupeHistory(undefined).messages).toEqual([]);
  });
});
