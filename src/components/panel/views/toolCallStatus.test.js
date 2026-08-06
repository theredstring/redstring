import { describe, it, expect } from 'vitest';
import {
  settleToolCallBlocks,
  settleToolCallBlocksInPlace,
  settleToolCallsInMessages
} from './toolCallStatus.js';

const REASON = 'The run ended before this tool returned a result.';

describe('settleToolCallBlocks', () => {
  it('settles a chip left running', () => {
    const blocks = [{ type: 'tool_call', id: 'a', name: 'mergeNodes', status: 'running' }];
    const settled = settleToolCallBlocks(blocks, REASON);
    expect(settled[0].status).toBe('cancelled');
    expect(settled[0].error).toBe(REASON);
  });

  it('settles a chip that never got a status at all', () => {
    const settled = settleToolCallBlocks([{ type: 'tool_call', id: 'a', name: 'expandGraph' }], REASON);
    expect(settled[0].status).toBe('cancelled');
  });

  it('leaves finished chips alone', () => {
    const blocks = [
      { type: 'tool_call', id: 'a', status: 'completed', result: { ok: true } },
      { type: 'tool_call', id: 'b', status: 'failed', error: 'boom' },
      { type: 'text', content: 'hello' }
    ];
    expect(settleToolCallBlocks(blocks, REASON)).toBe(blocks); // same reference — no React churn
  });

  it('keeps the tool\'s own error rather than overwriting it with the run-level reason', () => {
    const settled = settleToolCallBlocks(
      [{ type: 'tool_call', id: 'a', status: 'running', error: 'graph not found' }],
      REASON
    );
    expect(settled[0].error).toBe('graph not found');
  });

  it('tolerates missing or malformed block lists', () => {
    expect(settleToolCallBlocks(undefined, REASON)).toBeUndefined();
    expect(settleToolCallBlocks([null, undefined], REASON)).toEqual([null, undefined]);
  });
});

describe('settleToolCallBlocksInPlace', () => {
  it('matches the copying variant, mutating the array it is given', () => {
    const blocks = [
      { type: 'tool_call', id: 'a', status: 'running' },
      { type: 'tool_call', id: 'b', status: 'completed' }
    ];
    settleToolCallBlocksInPlace(blocks, REASON);
    expect(blocks[0].status).toBe('cancelled');
    expect(blocks[1].status).toBe('completed');
  });
});

describe('settleToolCallsInMessages', () => {
  it('repairs chips persisted mid-run so a reload does not show them spinning', () => {
    const messages = [
      { id: '1', sender: 'user', content: 'merge these' },
      {
        id: '2',
        sender: 'ai',
        contentBlocks: [
          { type: 'tool_call', id: 'a', name: 'mergeNodes', status: 'running' },
          { type: 'text', content: 'working on it' }
        ]
      }
    ];
    const settled = settleToolCallsInMessages(messages, REASON);
    expect(settled[1].contentBlocks[0].status).toBe('cancelled');
    expect(settled[0]).toBe(messages[0]); // untouched messages keep their identity
  });

  it('returns the same array when every chip is already terminal', () => {
    const messages = [{ id: '1', sender: 'ai', contentBlocks: [{ type: 'tool_call', status: 'completed' }] }];
    expect(settleToolCallsInMessages(messages, REASON)).toBe(messages);
  });
});
