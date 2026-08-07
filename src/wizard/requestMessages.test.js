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

  it('folds into a trailing plain-text user turn rather than adding a message', () => {
    const msgs = [
      { role: 'system', content: 'SYSTEM' },
      { role: 'user', content: 'build a cell' }
    ];
    const out = buildRequestMessages(msgs, 'GRAPH STATE');
    expect(out).toHaveLength(2);
    expect(out[1].content).toContain('build a cell');
    expect(out[1].content).toContain('GRAPH STATE');
    expect(isVolatileContextMessage(out[1])).toBe(true);
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
