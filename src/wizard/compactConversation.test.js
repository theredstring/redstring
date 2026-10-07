import { describe, it, expect } from 'vitest';
import {
  compactConversation,
  canCompact,
  projectHistory,
  estimateHistoryTokens,
  estimateMessageTokens,
  isCompactionSummary,
  KEEP_RECENT_MESSAGES,
  HISTORY_LIMIT,
  SUMMARY_TOKEN_LIMIT
} from './compactConversation.js';

const userMsg = (id, content, metadata) => ({ id, sender: 'user', content, contentBlocks: [], ...(metadata ? { metadata } : {}) });
const systemMsg = (id, content) => ({ id, sender: 'system', content, contentBlocks: [] });

const aiMsg = (id, { text = '', tools = [] } = {}) => ({
  id,
  sender: 'ai',
  content: text,
  contentBlocks: [
    ...tools.map(t => ({ type: 'tool_call', name: t.name, args: t.args || {}, result: t.result || {} })),
    ...(text ? [{ type: 'text', content: text }] : [])
  ]
});

/** n exchanges, each with a long Wizard reply and a bulky tool result. */
function longConversation(n = 20) {
  const msgs = [];
  for (let i = 0; i < n; i++) {
    msgs.push(userMsg(`u${i}`, `Please build layer ${i}`));
    msgs.push(aiMsg(`a${i}`, {
      text: `Built layer ${i}. ${'Here is a long explanation of what was built. '.repeat(60)}`,
      tools: [{
        name: 'createPopulatedGraph',
        args: { name: `Layer ${i}` },
        result: { nodes: Array.from({ length: 40 }, (_, j) => ({ id: `n${j}`, description: 'd'.repeat(200) })) }
      }]
    }));
  }
  return msgs;
}

describe('compactConversation', () => {
  it('leaves a single exchange alone', () => {
    const msgs = [userMsg('u1', 'hi'), aiMsg('a1', { text: 'hello' })];
    const result = compactConversation(msgs);

    expect(result.compacted).toBe(false);
    expect(result.messages).toBe(msgs);
    expect(canCompact(msgs)).toBe(false);
  });

  it('compacts three exchanges, however few messages that is', () => {
    // The conversation that used to answer "still short": six messages.
    const msgs = longConversation(3);
    expect(canCompact(msgs)).toBe(true);
    expect(compactConversation(msgs).compacted).toBe(true);
  });

  it('removes nothing: it inserts one summary before the kept tail', () => {
    const msgs = longConversation();
    const result = compactConversation(msgs);

    expect(result.messages.length).toBe(msgs.length + 1);
    for (const m of msgs) expect(result.messages).toContainEqual(m);
    const idx = result.messages.findIndex(isCompactionSummary);
    expect(idx).toBe(msgs.length - KEEP_RECENT_MESSAGES);
    expect(result.messages[idx].sender).toBe('system');
  });

  it('shrinks what the next ask sends', () => {
    const result = compactConversation(longConversation());
    expect(result.tokensAfter).toBeLessThan(result.tokensBefore * 0.7);
  });

  it('keeps a summary bounded however many times it folds', () => {
    let msgs = longConversation(30);
    for (let round = 0; round < 5; round++) {
      msgs = compactConversation(msgs).messages;
      msgs = [...msgs, ...longConversation(30).map(m => ({ ...m, id: `${m.id}-${round}` }))];
    }
    const summary = compactConversation(msgs).messages.filter(isCompactionSummary).pop();
    expect(estimateHistoryTokens([{ role: 'user', content: summary.content }])).toBeLessThan(SUMMARY_TOKEN_LIMIT + 100);
    expect(summary.content).toMatch(/\(\d+ earlier lines left out\)/);
  });

  it('records which tools ran, without their payloads, and skips undone ones', () => {
    const msgs = longConversation(3);
    msgs[1].contentBlocks.push({ type: 'tool_call', name: 'deleteNode', args: { name: 'Gone' }, isUndone: true });
    const summary = compactConversation(msgs).messages.find(isCompactionSummary).content;

    expect(summary).toContain('createPopulatedGraph(Layer 0)');
    expect(summary).not.toContain('dddddddddd');
    expect(summary).not.toContain('deleteNode');
  });

  it('flags failed tool calls in the summary', () => {
    const msgs = [
      userMsg('u0', 'remove A'),
      aiMsg('bad', { tools: [{ name: 'deleteEdge', args: { name: 'A' }, result: { error: 'no such edge' } }] }),
      userMsg('u1', 'next'),
      aiMsg('a1', { text: 'ok' })
    ];
    const summary = compactConversation(msgs).messages.find(isCompactionSummary).content;
    expect(summary).toContain('deleteEdge(A) FAILED');
  });

  it("leaves the panel's own notices out of the summary", () => {
    const msgs = [userMsg('u0', 'a'), systemMsg('s0', 'Error: something'), aiMsg('a0', { text: 'b' }), userMsg('u1', 'c'), aiMsg('a1', { text: 'd' })];
    const summary = compactConversation(msgs).messages.find(isCompactionSummary).content;
    expect(summary).not.toContain('Error: something');
  });

  it('folds the previous summary into the next one', () => {
    const once = compactConversation(longConversation(4)).messages;
    const twice = compactConversation([...once, ...longConversation(3).map(m => ({ ...m, id: `${m.id}-b` }))]).messages;

    const summaries = twice.filter(isCompactionSummary);
    expect(summaries.length).toBe(2);
    // The newest carries the first round forward, so it is the one sent.
    expect(summaries[1].content).toContain('Please build layer 0');
    expect(projectHistory(twice)[0].content).toBe(summaries[1].content);
  });

  it('measures tool results at the cap the model actually receives', () => {
    const huge = aiMsg('h', {
      tools: [{ name: 'inspectWorkspace', result: { blob: 'x'.repeat(5_000_000) } }]
    });
    expect(estimateMessageTokens(huge)).toBeLessThan(6100);
  });
});

describe('projectHistory', () => {
  it('sends prose, never tool payloads', () => {
    const history = projectHistory(longConversation(1));
    expect(JSON.stringify(history)).not.toContain('dddddddddd');
    expect(history.map(h => h.role)).toEqual(['user', 'assistant']);
  });

  it('starts at the newest summary, as a pinned user turn, however long ago it was', () => {
    const compacted = compactConversation(longConversation(3)).messages;
    const grown = [...compacted, ...longConversation(12).map(m => ({ ...m, id: `${m.id}-later` }))];
    const history = projectHistory(grown);

    expect(history[0]).toMatchObject({ role: 'user', pinned: true });
    expect(history[0].content).toContain('Please build layer 0');
    expect(history.length).toBe(HISTORY_LIMIT + 1);
  });

  it("counts an attachment's text and an image, not its bytes", () => {
    const withFiles = userMsg('u', 'see', {
      contentBlocksForHistory: [
        { type: 'text', text: 'see' },
        { type: 'image', data: 'A'.repeat(400000) },
        { type: 'document_text', text: 'word '.repeat(400) }
      ]
    });
    const tokens = estimateHistoryTokens(projectHistory([withFiles]));
    expect(tokens).toBeGreaterThan(1000);
    expect(tokens).toBeLessThan(2000);
  });
});

describe('compactConversation and plans', () => {
  it('does not carry plan state in messages at all', () => {
    // Plans live in the Zustand store, not the transcript, which is what lets
    // them survive compaction. Assert the separation rather than trust it.
    const serialized = JSON.stringify(compactConversation(longConversation()).messages);
    expect(serialized).not.toContain('_currentPlan');
    expect(serialized).not.toContain('wizardPlansByConversation');
  });
});
