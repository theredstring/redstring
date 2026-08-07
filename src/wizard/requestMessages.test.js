import { describe, it, expect } from 'vitest';
import {
  buildRequestMessages,
  isVolatileContextMessage,
  ENVIRONMENT_BLOCK_HEADER
} from './requestMessages.js';

describe('buildRequestMessages', () => {
  const base = [
    { role: 'system', content: 'SYSTEM' },
    { role: 'user', content: 'build a cell' },
    { role: 'assistant', content: '', tool_calls: [{ id: 't1', function: { name: 'readGraph', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 't1', content: '{"ok":true}' }
  ];

  it('appends the context as a trailing user message after a tool result', () => {
    const out = buildRequestMessages(base, 'GRAPH STATE');
    expect(out).toHaveLength(base.length + 1);
    const last = out[out.length - 1];
    expect(last.role).toBe('user');
    expect(last.content).toContain(ENVIRONMENT_BLOCK_HEADER);
    expect(last.content).toContain('GRAPH STATE');
    expect(isVolatileContextMessage(last)).toBe(true);
  });

  // Never folded into a preceding turn: rewriting an existing message's bytes
  // between iterations invalidates the cached prefix covering everything after
  // it, which is the whole conversation history.
  it('leaves earlier messages byte-identical across iterations', () => {
    const turn0 = [
      { role: 'system', content: 'SYSTEM' },
      { role: 'user', content: 'build a cell' }
    ];
    const turn1 = [
      ...turn0,
      { role: 'assistant', content: '', tool_calls: [{ id: 't1', function: { name: 'readGraph', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 't1', content: '{"ok":true}' }
    ];

    const a = buildRequestMessages(turn0, 'SNAPSHOT A');
    const b = buildRequestMessages(turn1, 'SNAPSHOT B');

    // The user's own turn must be identical in both requests.
    expect(a[1]).toEqual(turn0[1]);
    expect(b[1]).toEqual(turn0[1]);
    expect(a[1].content).not.toContain('SNAPSHOT');
  });

  it('always appends the context as its own message', () => {
    const msgs = [
      { role: 'system', content: 'SYSTEM' },
      { role: 'user', content: 'build a cell' }
    ];
    const out = buildRequestMessages(msgs, 'GRAPH STATE');
    expect(out).toHaveLength(3);
    expect(out[2].role).toBe('user');
    expect(out[2].content).toContain('GRAPH STATE');
    expect(isVolatileContextMessage(out[2])).toBe(true);
  });

  // The whole point of injecting at send time: if the block were written into the
  // canonical array, history bytes would shift every iteration and stay
  // uncacheable, and stale snapshots would pile up behind the current one.
  it('never mutates the input array or its messages', () => {
    const msgs = [
      { role: 'system', content: 'SYSTEM' },
      { role: 'user', content: 'build a cell' }
    ];
    const snapshot = JSON.parse(JSON.stringify(msgs));
    buildRequestMessages(msgs, 'GRAPH STATE');
    expect(msgs).toEqual(snapshot);
    expect(msgs).toHaveLength(2);
  });

  it('returns a copy unchanged when there is no context to inject', () => {
    const out = buildRequestMessages(base, '');
    expect(out).toEqual(base);
    expect(out).not.toBe(base);
    expect(out.some(isVolatileContextMessage)).toBe(false);
  });

  it('treats whitespace-only context as nothing to inject', () => {
    const out = buildRequestMessages(base, '   \n  ');
    expect(out).toHaveLength(base.length);
  });

  it('tolerates a missing message array without losing the context', () => {
    const out = buildRequestMessages(undefined, 'X');
    expect(out).toHaveLength(1);
    expect(out[0].content).toContain('X');
  });
});
