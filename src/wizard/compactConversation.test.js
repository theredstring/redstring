import { describe, it, expect } from 'vitest';
import {
  compactConversation,
  estimateMessageTokens,
  KEEP_RECENT_MESSAGES
} from './compactConversation.js';

const userMsg = (id, content) => ({ id, sender: 'user', content, contentBlocks: [] });

const aiMsg = (id, { text = '', tools = [] } = {}) => ({
  id,
  sender: 'ai',
  content: text,
  contentBlocks: [
    ...tools.map(t => ({ type: 'tool_call', name: t.name, args: t.args || {}, result: t.result || {} })),
    ...(text ? [{ type: 'text', content: text }] : [])
  ]
});

/** A conversation long enough to compact, with bulky tool results. */
function longConversation(n = 20) {
  const msgs = [];
  for (let i = 0; i < n; i++) {
    msgs.push(userMsg(`u${i}`, `Please build layer ${i}`));
    msgs.push(aiMsg(`a${i}`, {
      text: `Built layer ${i}.`,
      tools: [{
        name: 'createPopulatedGraph',
        args: { name: `Layer ${i}` },
        // Bulky payload — the thing compaction exists to shed.
        result: { nodes: Array.from({ length: 40 }, (_, j) => ({ id: `n${j}`, description: 'd'.repeat(200) })) }
      }]
    }));
  }
  return msgs;
}

describe('compactConversation', () => {
  it('leaves a short conversation alone', () => {
    const msgs = [userMsg('u1', 'hi'), aiMsg('a1', { text: 'hello' })];
    const result = compactConversation(msgs);

    expect(result.compacted).toBe(false);
    expect(result.messages).toBe(msgs);
  });

  it('substantially reduces token count on a long conversation', () => {
    const result = compactConversation(longConversation());

    expect(result.compacted).toBe(true);
    expect(result.tokensAfter).toBeLessThan(result.tokensBefore * 0.3);
  });

  it('keeps the most recent exchanges verbatim', () => {
    const msgs = longConversation();
    const result = compactConversation(msgs);
    const kept = msgs.slice(-KEEP_RECENT_MESSAGES);

    for (const m of kept) {
      expect(result.messages).toContainEqual(m);
    }
  });

  it('puts a single summary message first', () => {
    const result = compactConversation(longConversation());

    expect(result.messages[0].metadata.kind).toBe('compaction-summary');
    expect(result.messages[0].sender).toBe('system');
    expect(result.messages.length).toBe(KEEP_RECENT_MESSAGES + 1);
  });

  it('records which tools ran, without their payloads', () => {
    const result = compactConversation(longConversation());
    const summary = result.messages[0].content;

    expect(summary).toContain('createPopulatedGraph');
    // The bulky node payload must not survive.
    expect(summary).not.toContain('dddddddddd');
  });

  it('flags failed tool calls in the summary', () => {
    const msgs = [
      ...Array.from({ length: 10 }, (_, i) => userMsg(`u${i}`, `msg ${i}`)),
      aiMsg('bad', { tools: [{ name: 'deleteEdge', args: { name: 'A' }, result: { error: 'no such edge' } }] }),
      ...Array.from({ length: KEEP_RECENT_MESSAGES }, (_, i) => userMsg(`k${i}`, `keep ${i}`))
    ];
    const result = compactConversation(msgs);

    expect(result.messages[0].content).toContain('deleteEdge(A) FAILED');
  });

  it('does not nest summaries when compacted twice', () => {
    const once = compactConversation(longConversation());
    // Grow the conversation again, then compact a second time.
    const grown = [...once.messages, ...longConversation(6)];
    const twice = compactConversation(grown);

    const summaries = twice.messages.filter(m => m?.metadata?.kind === 'compaction-summary');
    expect(summaries.length).toBe(1);
    // The first round's content is carried forward rather than discarded.
    expect(summaries[0].content).toContain('Please build layer 0');
  });

  it('never leaves a message marked as streaming', () => {
    const msgs = longConversation();
    msgs[0].isStreaming = true;
    const result = compactConversation(msgs);

    expect(result.messages.some(m => m.isStreaming)).toBe(false);
  });

  it('measures tool results at the cap the model actually receives', () => {
    // A single vast result must not be counted at full size — the model only
    // ever received the capped version.
    const huge = aiMsg('h', {
      tools: [{ name: 'inspectWorkspace', result: { blob: 'x'.repeat(5_000_000) } }]
    });
    // 24k chars / 4 = 6000 tokens is the ceiling.
    expect(estimateMessageTokens(huge)).toBeLessThan(6100);
  });
});

describe('compactConversation and plans', () => {
  it('does not carry plan state in messages at all', () => {
    // The guarantee that makes plans survive compaction: they live in the
    // Zustand store, not the transcript. If a plan ever started riding along in
    // message metadata, compaction could drop it — so assert the separation
    // rather than trusting it.
    const result = compactConversation(longConversation());
    const serialized = JSON.stringify(result.messages);

    expect(serialized).not.toContain('_currentPlan');
    expect(serialized).not.toContain('wizardPlansByConversation');
  });
});
