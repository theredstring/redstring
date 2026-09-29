// @vitest-environment node
/**
 * Each provider's request, checked against that service's own API rules.
 *
 * The end-to-end suite proves the loop runs over every provider; this one pins
 * the wire details a service rejects outright, each of which shipped broken at
 * some point: Anthropic tools in OpenAI's shape, sampling parameters Claude
 * models refuse, a key posted to another service's host, a Gemini key in the
 * query string, parallel Gemini results split across turns.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { installFakeProvider } from './fakeProvider.js';
import { streamLLM, resolveEndpoint, resolveAnthropicModel } from '../../src/wizard/LLMClient.js';
import { callLLM } from '../../src/services/agent/llmCaller.js';

let provider;
beforeAll(() => {
  for (const k of ['log', 'warn', 'error', 'info', 'debug']) vi.spyOn(console, k).mockImplementation(() => {});
});
afterEach(() => provider?.restore());

const TOOL = {
  name: 'createNode',
  description: 'Create a node.',
  parameters: { type: 'object', properties: { name: { type: 'string' }, color: { type: 'string' } }, required: ['name'] }
};
const MESSAGES = [{ role: 'system', content: 'You are the Wizard.' }, { role: 'user', content: 'hi' }];

async function drain(config, { messages = MESSAGES, tools = [TOOL], script = [{ text: 'ok' }], wire } = {}) {
  provider = installFakeProvider(wire || 'openai', script);
  const chunks = [];
  let error = null;
  try {
    for await (const c of streamLLM(messages, tools, config)) chunks.push(c);
  } catch (e) {
    error = e;
  }
  return { chunks, error, request: provider.model[0], other: provider.other, text: chunks.filter(c => c.type === 'text').map(c => c.content).join('') };
}

describe('keys only go to their own service', () => {
  it.each([
    ['anthropic', undefined, 'https://api.anthropic.com/v1/messages'],
    ['openai', undefined, 'https://api.openai.com/v1/chat/completions'],
    ['openrouter', undefined, 'https://openrouter.ai/api/v1/chat/completions'],
    // LeftAIView's sk-ant- auto-switch leaves the OpenRouter URL on the profile
    ['anthropic', 'https://openrouter.ai/api/v1/chat/completions', 'https://api.anthropic.com/v1/messages'],
    ['openai', 'https://api.anthropic.com/v1/messages', 'https://api.openai.com/v1/chat/completions'],
    // proxies and gateways the user chose are respected
    ['anthropic', 'https://gateway.example.com/anthropic/v1/messages', 'https://gateway.example.com/anthropic/v1/messages'],
    ['local', undefined, 'http://localhost:11434/v1/chat/completions']
  ])('%s with endpoint %s → %s', (p, endpoint, expected) => {
    expect(resolveEndpoint(p, endpoint)).toBe(expected);
  });

  it('never falls back to OpenRouter for a direct Anthropic key', async () => {
    const r = await drain({ provider: 'anthropic', apiKey: 'sk-ant-test' }, { wire: 'anthropic' });
    expect(r.request.url).toBe('https://api.anthropic.com/v1/messages');
  });
});

describe('Anthropic Messages API', () => {
  it('sends tools as { name, description, input_schema }, no temperature, the browser header', async () => {
    const r = await drain({ provider: 'anthropic', apiKey: 'sk-ant-test', model: 'claude-sonnet-5-5', temperature: 0.7 }, { wire: 'anthropic' });
    const { body, headers } = r.request;
    expect(r.error).toBeNull();
    expect(headers['x-api-key']).toBe('sk-ant-test');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(headers['anthropic-dangerous-direct-browser-access']).toBe('true');
    expect(body.tools[0]).toMatchObject({ name: 'createNode', description: 'Create a node.', input_schema: { type: 'object' } });
    expect(body.tools[0]).not.toHaveProperty('type');
    expect(body.tools[0]).not.toHaveProperty('function');
    expect(body).not.toHaveProperty('temperature');
    expect(body.system).toBeTruthy();
    expect(body.messages.every(m => m.role !== 'system')).toBe(true);
    expect(r.text).toBe('ok');
  });

  it.each([
    [undefined, 'claude-sonnet-5-5'],
    ['anthropic/claude-sonnet-5.5', 'claude-sonnet-5-5'],
    ['anthropic/claude-haiku-4.5', 'claude-haiku-4-5'],
    ['claude-3-5-sonnet-20241022', 'claude-sonnet-5-5'],
    ['claude-3-5-haiku-20241022', 'claude-haiku-4-5'],
    ['openai/gpt-4o', 'claude-sonnet-5-5'],
    ['claude-opus-5-5', 'claude-opus-5-5']
  ])('model %s is sent as %s', (input, expected) => {
    expect(resolveAnthropicModel(input)).toBe(expected);
  });

  it('streams text past the thinking blocks current models send first', async () => {
    const thinkingThenText =
      'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":10,"output_tokens":1}}}\n\n' +
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}\n\n' +
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"abc"}}\n\n' +
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n' +
      'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}\n\n' +
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"Hello"}}\n\n' +
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":1}\n\n' +
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}\n\n';
    const r = await drain({ provider: 'anthropic', apiKey: 'k' }, { wire: 'anthropic', script: [{ raw: thinkingThenText }] });
    expect(r.error).toBeNull();
    expect(r.text).toBe('Hello');
    expect(r.chunks.filter(c => c.type === 'tool_call')).toHaveLength(0);
  });

  it('surfaces an overloaded error sent mid-stream instead of an empty reply', async () => {
    const raw = 'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":10}}}\n\n' +
      'event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\n\n';
    const r = await drain({ provider: 'anthropic', apiKey: 'k' }, { wire: 'anthropic', script: [{ raw }] });
    expect(r.error?.message).toMatch(/overloaded_error/);
  });

  it('reports a safety refusal as an error rather than silence', async () => {
    const raw = 'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":10}}}\n\n' +
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"refusal"},"usage":{"output_tokens":0}}\n\n';
    const r = await drain({ provider: 'anthropic', apiKey: 'k' }, { wire: 'anthropic', script: [{ raw }] });
    expect(r.error?.message).toMatch(/declined/);
  });

  it('gives thinking room: max_tokens defaults to 32000 when unset', async () => {
    const r = await drain({ provider: 'anthropic', apiKey: 'k' }, { wire: 'anthropic' });
    expect(r.request.body.max_tokens).toBe(32000);
  });
});

describe('OpenAI chat completions', () => {
  it('uses max_completion_tokens and no temperature for GPT-5 reasoning models', async () => {
    const r = await drain({ provider: 'openai', apiKey: 'sk-test', model: 'gpt-5.5', temperature: 0.7, maxTokens: 4000 });
    expect(r.request.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(r.request.body.max_completion_tokens).toBe(4000);
    expect(r.request.body).not.toHaveProperty('max_tokens');
    expect(r.request.body).not.toHaveProperty('temperature');
    expect(r.request.body.tools[0]).toMatchObject({ type: 'function', function: { name: 'createNode' } });
    expect(r.request.headers.Authorization).toBe('Bearer sk-test');
  });

  it('keeps temperature for non-reasoning models', async () => {
    const r = await drain({ provider: 'openai', apiKey: 'sk-test', model: 'gpt-4o', temperature: 0.5 });
    expect(r.request.body.temperature).toBe(0.5);
    expect(r.request.body.max_completion_tokens).toBeDefined();
  });

  it('local and custom servers keep the classic fields', async () => {
    const r = await drain({ provider: 'local', endpoint: 'http://localhost:11434/v1/chat/completions', model: 'llama3' });
    expect(r.request.body.max_tokens).toBeDefined();
    expect(r.request.body).not.toHaveProperty('max_completion_tokens');
    expect(r.request.body.temperature).toBe(0.1);
    const c = await drain({ provider: 'together', endpoint: 'https://llm.example.test/v1/chat/completions', model: 'm' });
    expect(c.request.url).toBe('https://llm.example.test/v1/chat/completions');
    expect(c.text).toBe('ok');
  });

  it('surfaces an error chunk sent mid-stream (OpenRouter and OpenAI)', async () => {
    const raw = 'data: {"choices":[{"index":0,"delta":{"content":"Hel"}}]}\n\n' +
      'data: {"error":{"code":502,"message":"Provider returned error"},"choices":[{"index":0,"delta":{},"finish_reason":"error"}]}\n\n';
    for (const p of ['openrouter', 'openai']) {
      const r = await drain({ provider: p, apiKey: 'k', model: 'm' }, { script: [{ raw }] });
      expect(r.error?.message).toMatch(/Provider returned error/);
    }
  });

  it('refuses Cohere with a clear message instead of a protocol error', async () => {
    const r = await drain({ provider: 'cohere', apiKey: 'k' });
    expect(r.error?.message).toMatch(/Cohere isn't supported/);
    expect(r.request).toBeUndefined();
  });
});

describe('Gemini generateContent', () => {
  it('sends the key in a header, never the URL', async () => {
    const r = await drain({ provider: 'google', apiKey: 'AIza-test', model: 'gemini-3.5-flash' }, { wire: 'google' });
    expect(r.request.url).toMatch(/^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-3\.5-flash:streamGenerateContent\?alt=sse$/);
    expect(r.request.url).not.toContain('AIza-test');
    expect(r.request.headers['x-goog-api-key']).toBe('AIza-test');
    expect(r.request.body.tools[0].functionDeclarations[0].name).toBe('createNode');
    expect(r.text).toBe('ok');
  });

  it('returns every result of a parallel turn in one content, each response an object', async () => {
    const messages = [
      ...MESSAGES,
      { role: 'assistant', content: '', tool_calls: [
        { id: 'a', function: { name: 'createNode', arguments: '{"name":"A"}' } },
        { id: 'b', function: { name: 'createNode', arguments: '{"name":"B"}' } }
      ] },
      { role: 'tool', tool_call_id: 'a', content: '{"ok":true}' },
      { role: 'tool', tool_call_id: 'b', content: '[1,2]' }
    ];
    const r = await drain({ provider: 'google', apiKey: 'k', model: 'gemini-3.5-flash' }, { wire: 'google', messages });
    const contents = r.request.body.contents;
    const responses = contents[contents.length - 1];
    expect(responses.role).toBe('user');
    expect(responses.parts.map(p => p.functionResponse.name)).toEqual(['createNode', 'createNode']);
    expect(responses.parts[1].functionResponse.response).toEqual({ result: [1, 2] });
  });

  it('does not show a thought summary as the reply', async () => {
    const raw = 'data: {"candidates":[{"content":{"role":"model","parts":[{"text":"thinking about it","thought":true}]}}]}\n\n' +
      'data: {"candidates":[{"content":{"role":"model","parts":[{"text":"Answer"}]},"finishReason":"STOP"}]}\n\n';
    const r = await drain({ provider: 'google', apiKey: 'k', model: 'gemini-3.5-flash' }, { wire: 'google', script: [{ raw }] });
    expect(r.text).toBe('Answer');
  });
});

describe('one-shot calls (llmCaller) ride the same providers', () => {
  it('reads an Anthropic reply that follows a thinking block, with room to think', async () => {
    provider = installFakeProvider('anthropic', [{ text: 'yes' }]);
    const text = await callLLM({ apiKey: 'sk-ant-test', provider: 'anthropic', systemPrompt: 's', userPrompt: 'q', maxTokens: 32, temperature: 0 });
    const { body, headers } = provider.model[0];
    expect(text).toBe('yes');
    expect(body.max_tokens).toBe(2048);
    expect(body).not.toHaveProperty('temperature');
    expect(headers['anthropic-dangerous-direct-browser-access']).toBe('true');
  });

  it('sends an OpenAI key to OpenAI, not to a local server, when no endpoint is set', async () => {
    provider = installFakeProvider('openai', [{ text: 'ok' }]);
    await callLLM({ apiKey: 'sk-test', provider: 'openai', model: 'gpt-4o', userPrompt: 'q' });
    expect(provider.model[0].url).toBe('https://api.openai.com/v1/chat/completions');
  });

  it('supports Gemini', async () => {
    provider = installFakeProvider('google', [{ text: 'ok' }]);
    expect(await callLLM({ apiKey: 'AIza', provider: 'google', model: 'gemini-3.5-flash', userPrompt: 'q' })).toBe('ok');
  });
});

