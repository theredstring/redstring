/**
 * Tests for LLMClient
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { streamLLM, applyHistoryCacheBreakpoints, _makeAllRequired as makeAllRequired, _flattenDeepNesting as flattenDeepNesting, _stripNulls as stripNulls, _deepParseJsonStrings as deepParseJsonStrings, _condenseSchema as condenseSchema, _stripEmptyRequired as stripEmptyRequired, _normalizeTools as normalizeTools } from './LLMClient.js';
import { getToolDefinitions, selectToolsForTurn } from './tools/schemas.js';
import { listTools } from './tools/listTools.js';

/**
 * Create a mock ReadableStream for SSE data
 */
function createMockSSEStream(lines) {
  const encoder = new TextEncoder();
  const chunks = lines.map(line => encoder.encode(line + '\n'));

  return new ReadableStream({
    async start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      controller.close();
    }
  });
}

/**
 * Create a mock fetch response with SSE body
 */
function createMockFetchResponse(lines, ok = true, status = 200) {
  return {
    ok,
    status,
    body: createMockSSEStream(lines),
    text: async () => 'Error response'
  };
}

describe('LLMClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  describe('streamLLM - OpenRouter', () => {
    it('yields text chunks from OpenRouter stream', async () => {
      global.fetch.mockResolvedValue(createMockFetchResponse([
        'data: {"choices":[{"delta":{"content":"Hello"}}]}',
        'data: {"choices":[{"delta":{"content":" world"}}]}',
        'data: [DONE]'
      ]));

      const messages = [{ role: 'user', content: 'Hello' }];
      const chunks = [];

      for await (const chunk of streamLLM(messages, [], { provider: 'openrouter', apiKey: 'test-key' })) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual([
        { type: 'text', content: 'Hello' },
        { type: 'text', content: ' world' }
      ]);

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-key'
          })
        })
      );
    });

    it('yields tool_call chunks from OpenRouter stream', async () => {
      global.fetch.mockResolvedValue(createMockFetchResponse([
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-123","function":{"name":"createNode"}}]}}]}',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"name\\":\\"Test\\"}"}}]}}]}',
        'data: {"choices":[{"finish_reason":"tool_calls"}]}',
        'data: [DONE]'
      ]));

      const messages = [{ role: 'user', content: 'Create a node' }];
      const tools = [{ name: 'createNode', description: 'Create a node' }];
      const chunks = [];

      for await (const chunk of streamLLM(messages, tools, { provider: 'openrouter', apiKey: 'test-key' })) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBeGreaterThan(0);
      const toolCall = chunks.find(c => c.type === 'tool_call');
      expect(toolCall).toBeDefined();
      expect(toolCall.name).toBe('createNode');
      expect(toolCall.args).toEqual({ name: 'Test' });
    });

    it('handles multiple tool calls', async () => {
      global.fetch.mockResolvedValue(createMockFetchResponse([
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"createNode"}}]}}]}',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"name\\":\\"Node1\\"}"}}]}}]}',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":1,"id":"call-2","function":{"name":"createEdge"}}]}}]}',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":1,"function":{"arguments":"{\\"source\\":\\"Node1\\"}"}}]}}]}',
        'data: {"choices":[{"finish_reason":"tool_calls"}]}',
        'data: [DONE]'
      ]));

      const messages = [{ role: 'user', content: 'Create nodes' }];
      const chunks = [];

      for await (const chunk of streamLLM(messages, [], { provider: 'openrouter' })) {
        chunks.push(chunk);
      }

      const toolCalls = chunks.filter(c => c.type === 'tool_call');
      expect(toolCalls.length).toBeGreaterThanOrEqual(2);
    });

    it('throws error on non-2xx response', async () => {
      global.fetch.mockResolvedValue(createMockFetchResponse([], false, 401));

      const messages = [{ role: 'user', content: 'Hello' }];
      const generator = streamLLM(messages, [], { provider: 'openrouter', apiKey: 'invalid' });

      await expect(async () => {
        for await (const _ of generator) { }
      }).rejects.toThrow('OpenRouter API error');
    });

    it('normalizes tools to OpenAI format', async () => {
      global.fetch.mockResolvedValue(createMockFetchResponse(['data: [DONE]']));

      const messages = [{ role: 'user', content: 'Hello' }];
      const tools = [
        { name: 'createNode', description: 'Create a node', parameters: { type: 'object' } }
      ];

      await (async () => {
        for await (const _ of streamLLM(messages, tools, { provider: 'openrouter' })) { }
      })();

      const fetchCall = global.fetch.mock.calls[0];
      const payload = JSON.parse(fetchCall[1].body);
      expect(payload.tools).toBeDefined();
      expect(payload.tools[0]).toEqual({
        type: 'function',
        function: {
          name: 'createNode',
          description: 'Create a node',
          parameters: { type: 'object' }
        }
      });
    });

    it('uses default config when not provided', async () => {
      global.fetch.mockResolvedValue(createMockFetchResponse(['data: [DONE]']));

      const messages = [{ role: 'user', content: 'Hello' }];

      await (async () => {
        for await (const _ of streamLLM(messages, [])) { }
      })();

      const fetchCall = global.fetch.mock.calls[0];
      const payload = JSON.parse(fetchCall[1].body);
      expect(payload.model).toBe('anthropic/claude-3.5-sonnet');
      expect(payload.temperature).toBe(0.7);
      expect(payload.max_tokens).toBe(8192);
    });
  });

  describe('streamLLM - Anthropic', () => {
    it('yields text chunks from Anthropic stream', async () => {
      global.fetch.mockResolvedValue(createMockFetchResponse([
        'data: {"type":"content_block_delta","delta":{"type":"text","text":"Hello"}}',
        'data: {"type":"content_block_delta","delta":{"type":"text","text":" world"}}',
        'data: {"type":"message_stop"}'
      ]));

      const messages = [{ role: 'user', content: 'Hello' }];
      const chunks = [];

      for await (const chunk of streamLLM(messages, [], { provider: 'anthropic', apiKey: 'test-key' })) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual([
        { type: 'text', content: 'Hello' },
        { type: 'text', content: ' world' }
      ]);

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'x-api-key': 'test-key',
            'anthropic-version': '2023-06-01'
          })
        })
      );
    });

    it('separates system message from conversation', async () => {
      global.fetch.mockResolvedValue(createMockFetchResponse(['data: {"type":"message_stop"}']));

      const messages = [
        { role: 'system', content: 'You are a wizard' },
        { role: 'user', content: 'Hello' }
      ];

      await (async () => {
        for await (const _ of streamLLM(messages, [], { provider: 'anthropic' })) { }
      })();

      const fetchCall = global.fetch.mock.calls[0];
      const payload = JSON.parse(fetchCall[1].body);
      expect(payload.system).toBe('You are a wizard');
      expect(payload.messages).toEqual([{ role: 'user', content: 'Hello' }]);
    });

    it('throws error on Anthropic API error', async () => {
      global.fetch.mockResolvedValue(createMockFetchResponse([], false, 400));

      const messages = [{ role: 'user', content: 'Hello' }];
      const generator = streamLLM(messages, [], { provider: 'anthropic', apiKey: 'invalid' });

      await expect(async () => {
        for await (const _ of generator) { }
      }).rejects.toThrow('Anthropic API error');
    });
  });

  describe('streamLLM - Local/OpenAI', () => {
    it('yields text chunks from OpenAI-compatible stream', async () => {
      global.fetch.mockResolvedValue(createMockFetchResponse([
        'data: {"choices":[{"delta":{"content":"Hello"}}]}',
        'data: {"choices":[{"delta":{"content":" world"}}]}',
        'data: [DONE]'
      ]));

      const messages = [{ role: 'user', content: 'Hello' }];
      const chunks = [];

      for await (const chunk of streamLLM(messages, [], {
        provider: 'local',
        endpoint: 'http://localhost:11434/v1/chat/completions',
        apiKey: ''
      })) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBeGreaterThan(0);
      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:11434/v1/chat/completions',
        expect.objectContaining({
          method: 'POST'
        })
      );
    });

    it('works without API key for local providers', async () => {
      global.fetch.mockResolvedValue(createMockFetchResponse(['data: [DONE]']));

      const messages = [{ role: 'user', content: 'Hello' }];

      await (async () => {
        for await (const _ of streamLLM(messages, [], {
          provider: 'local',
          endpoint: 'http://localhost:11434/v1/chat/completions'
        })) { }
      })();

      const fetchCall = global.fetch.mock.calls[0];
      const headers = fetchCall[1].headers;
      // Should not have Authorization header or it should be empty
      expect(headers['Authorization']).toBeUndefined();
    });

    it('throws error for unsupported provider', async () => {
      const messages = [{ role: 'user', content: 'Hello' }];
      const generator = streamLLM(messages, [], { provider: 'unsupported' });

      await expect(async () => {
        for await (const _ of generator) { }
      }).rejects.toThrow('Unsupported provider');
    });
  });

  describe('Edge cases', () => {
    it('handles empty tool array', async () => {
      global.fetch.mockResolvedValue(createMockFetchResponse(['data: [DONE]']));

      const messages = [{ role: 'user', content: 'Hello' }];

      await (async () => {
        for await (const _ of streamLLM(messages, [], { provider: 'openrouter' })) { }
      })();

      const fetchCall = global.fetch.mock.calls[0];
      const payload = JSON.parse(fetchCall[1].body);
      expect(payload.tools).toBeUndefined();
    });

    it('handles malformed JSON in stream', async () => {
      global.fetch.mockResolvedValue(createMockFetchResponse([
        'data: {"choices":[{"delta":{"content":"Hello"}}]}',
        'data: invalid json',
        'data: {"choices":[{"delta":{"content":" world"}}]}',
        'data: [DONE]'
      ]));

      const messages = [{ role: 'user', content: 'Hello' }];
      const chunks = [];

      for await (const chunk of streamLLM(messages, [], { provider: 'openrouter' })) {
        chunks.push(chunk);
      }

      // Should still yield valid chunks
      expect(chunks.length).toBeGreaterThan(0);
    });

    it('handles empty response', async () => {
      global.fetch.mockResolvedValue(createMockFetchResponse([]));

      const messages = [{ role: 'user', content: 'Hello' }];
      const chunks = [];

      for await (const chunk of streamLLM(messages, [], { provider: 'openrouter' })) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual([]);
    });
  });

  describe('streamLLM - token usage', () => {
    it('emits a usage chunk from an OpenAI-format final chunk (choices: [])', async () => {
      global.fetch.mockResolvedValue(createMockFetchResponse([
        'data: {"choices":[{"delta":{"content":"Hi"}}]}',
        'data: {"choices":[],"usage":{"prompt_tokens":1200,"completion_tokens":34,"total_tokens":1234}}',
        'data: [DONE]'
      ]));

      const chunks = [];
      for await (const chunk of streamLLM([{ role: 'user', content: 'Hi' }], [], { provider: 'openrouter', apiKey: 'k' })) {
        chunks.push(chunk);
      }

      const usage = chunks.find(c => c.type === 'usage');
      expect(usage).toEqual({
        type: 'usage',
        usage: {
          promptTokens: 1200,
          completionTokens: 34,
          totalTokens: 1234,
          uncachedPromptTokens: 1200,
          cacheReadTokens: 0,
          cacheCreationTokens: 0
        }
      });
    });

    it('credits OpenAI-reported cached prompt tokens', async () => {
      global.fetch.mockResolvedValue(createMockFetchResponse([
        'data: {"choices":[],"usage":{"prompt_tokens":1200,"completion_tokens":34,"total_tokens":1234,"prompt_tokens_details":{"cached_tokens":1000}}}',
        'data: [DONE]'
      ]));

      const chunks = [];
      for await (const chunk of streamLLM([{ role: 'user', content: 'Hi' }], [], { provider: 'openrouter', apiKey: 'k' })) {
        chunks.push(chunk);
      }

      const usage = chunks.find(c => c.type === 'usage');
      expect(usage.usage.cacheReadTokens).toBe(1000);
      expect(usage.usage.uncachedPromptTokens).toBe(200);
    });

    it('requests usage in the stream via stream_options', async () => {
      global.fetch.mockResolvedValue(createMockFetchResponse(['data: [DONE]']));

      for await (const _ of streamLLM([{ role: 'user', content: 'Hi' }], [], { provider: 'openrouter', apiKey: 'k' })) { /* drain */ }

      const body = JSON.parse(global.fetch.mock.calls[0][1].body);
      expect(body.stream_options).toEqual({ include_usage: true });
    });

    it('emits a usage chunk from Gemini usageMetadata', async () => {
      global.fetch.mockResolvedValue(createMockFetchResponse([
        'data: {"candidates":[{"content":{"parts":[{"text":"Hello"}]}}]}',
        'data: {"candidates":[{"content":{"parts":[]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":900,"candidatesTokenCount":40,"totalTokenCount":940}}'
      ]));

      const chunks = [];
      for await (const chunk of streamLLM([{ role: 'user', content: 'Hi' }], [], { provider: 'google', apiKey: 'k', model: 'gemini-2.5-flash' })) {
        chunks.push(chunk);
      }

      const usage = chunks.find(c => c.type === 'usage');
      // completion derived from total - prompt (thinking-model safe).
      expect(usage).toEqual({
        type: 'usage',
        usage: {
          promptTokens: 900,
          completionTokens: 40,
          totalTokens: 940,
          // No cachedContentTokenCount in this response — all input uncached.
          uncachedPromptTokens: 900,
          cacheReadTokens: 0,
          cacheCreationTokens: 0
        }
      });
    });

    it('emits a usage chunk from Anthropic message_start + message_delta', async () => {
      global.fetch.mockResolvedValue(createMockFetchResponse([
        'data: {"type":"message_start","message":{"usage":{"input_tokens":500,"output_tokens":0}}}',
        'data: {"type":"content_block_delta","delta":{"type":"text","text":"Hi"}}',
        'data: {"type":"message_delta","usage":{"output_tokens":25}}',
        'data: {"type":"message_stop"}'
      ]));

      const chunks = [];
      for await (const chunk of streamLLM([{ role: 'user', content: 'Hi' }], [], { provider: 'anthropic', apiKey: 'k' })) {
        chunks.push(chunk);
      }

      const usage = chunks.find(c => c.type === 'usage');
      expect(usage).toEqual({
        type: 'usage',
        usage: {
          promptTokens: 500,
          completionTokens: 25,
          totalTokens: 525,
          uncachedPromptTokens: 500,
          cacheReadTokens: 0,
          cacheCreationTokens: 0
        }
      });
    });

    it('splits cached from uncached input tokens on Anthropic', async () => {
      // With prompt caching live, input_tokens covers ONLY the uncached remainder;
      // the cached prefix arrives in its own fields. promptTokens has to report the
      // full input the model read, or context math silently loses the cached span.
      global.fetch.mockResolvedValue(createMockFetchResponse([
        'data: {"type":"message_start","message":{"usage":{"input_tokens":300,"cache_read_input_tokens":25000,"cache_creation_input_tokens":0,"output_tokens":0}}}',
        'data: {"type":"message_delta","usage":{"output_tokens":40}}',
        'data: {"type":"message_stop"}'
      ]));

      const chunks = [];
      for await (const chunk of streamLLM([{ role: 'user', content: 'Hi' }], [], { provider: 'anthropic', apiKey: 'k' })) {
        chunks.push(chunk);
      }

      const usage = chunks.find(c => c.type === 'usage');
      expect(usage.usage).toEqual({
        promptTokens: 25300,
        completionTokens: 40,
        totalTokens: 25340,
        uncachedPromptTokens: 300,
        cacheReadTokens: 25000,
        cacheCreationTokens: 0
      });
    });

    it('marks the system prefix and last tool as cacheable for Anthropic', async () => {
      global.fetch.mockResolvedValue(createMockFetchResponse([
        'data: {"type":"message_stop"}'
      ]));

      const tools = [
        { name: 'alpha', description: 'a', input_schema: { type: 'object', properties: {} } },
        { name: 'beta', description: 'b', input_schema: { type: 'object', properties: {} } }
      ];
      const messages = [
        { role: 'system', content: 'STATIC PROMPT\nVOLATILE CONTEXT', _cachePrefix: 'STATIC PROMPT\n' },
        { role: 'user', content: 'Hi' }
      ];

      for await (const _ of streamLLM(messages, tools, { provider: 'anthropic', apiKey: 'k' })) { /* drain */ }

      const body = JSON.parse(global.fetch.mock.calls[0][1].body);
      // System splits into a cached prefix + an uncached volatile tail.
      expect(body.system).toEqual([
        { type: 'text', text: 'STATIC PROMPT\n', cache_control: { type: 'ephemeral' } },
        { type: 'text', text: 'VOLATILE CONTEXT' }
      ]);
      // Only the LAST tool carries the breakpoint — it caches every tool before it.
      expect(body.tools[0].cache_control).toBeUndefined();
      expect(body.tools[1].cache_control).toEqual({ type: 'ephemeral' });
    });

    it('leaves the system message a plain string when there is no stable prefix', async () => {
      global.fetch.mockResolvedValue(createMockFetchResponse([
        'data: {"type":"message_stop"}'
      ]));

      const messages = [
        { role: 'system', content: 'All of this changes every turn' },
        { role: 'user', content: 'Hi' }
      ];

      for await (const _ of streamLLM(messages, [], { provider: 'anthropic', apiKey: 'k' })) { /* drain */ }

      const body = JSON.parse(global.fetch.mock.calls[0][1].body);
      expect(body.system).toBe('All of this changes every turn');
    });
  });
});

describe('normalizeTools schema pipeline', () => {
  it('makes all top-level properties required', () => {
    const schema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        color: { type: 'string' },
        description: { type: 'string' },
      },
      required: ['name'],
    };

    makeAllRequired(schema);

    expect(schema.required).toEqual(['name', 'color', 'description']);
  });

  it('marks previously-optional properties with (optional) in description', () => {
    const schema = {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The name' },
        color: { type: 'string', description: 'A color' },
        extra: { type: 'string' },
      },
      required: ['name'],
    };

    makeAllRequired(schema);

    // Originally required — description unchanged
    expect(schema.properties.name.description).toBe('The name');
    // Originally optional — "(optional)" appended
    expect(schema.properties.color.description).toBe('A color (optional)');
    expect(schema.properties.extra.description).toBe('(optional)');
    // No nullable anywhere
    expect(schema.properties.name.nullable).toBeUndefined();
    expect(schema.properties.color.nullable).toBeUndefined();
  });

  it('flattens arrays-of-objects to JSON string', () => {
    const schema = {
      type: 'object',
      properties: {
        nodes: {
          type: 'array',
          description: 'Array of nodes',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              color: { type: 'string' },
            },
            required: ['name'],
          },
        },
      },
      required: ['nodes'],
    };

    flattenDeepNesting(schema);

    // Array-of-objects becomes a JSON string
    expect(schema.properties.nodes.type).toBe('string');
    expect(schema.properties.nodes.description).toContain('JSON array of objects');
    expect(schema.properties.nodes.description).toContain('name (string)');
  });

  it('flattens top-level object with deep nesting to JSON string', () => {
    const schema = {
      type: 'object',
      properties: {
        mapping: {
          type: 'object',
          description: 'Column mapping',
          properties: {
            nodeNameColumn: { type: 'string' },
            foreignKeyMappings: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  column: { type: 'string' },
                  edgeLabel: { type: 'string' },
                },
              },
            },
          },
        },
      },
      required: ['mapping'],
    };

    flattenDeepNesting(schema);

    expect(schema.properties.mapping.type).toBe('string');
    expect(schema.properties.mapping.description).toContain('JSON object');
  });

  it('handles importTabularAsGraph schema correctly', () => {
    const tools = getToolDefinitions();
    const importTool = tools.find(t => t.name === 'importTabularAsGraph');
    expect(importTool).toBeDefined();

    const params = JSON.parse(JSON.stringify(importTool.parameters));
    stripEmptyRequired(params);
    condenseSchema(params);
    flattenDeepNesting(params);
    makeAllRequired(params);

    // mapping should be flattened to JSON string
    expect(params.properties.mapping.type).toBe('string');

    // All properties required, optional ones marked in description
    expect(params.required).toContain('graphName');
    expect(params.required).toContain('maxNodes');
    expect(params.properties.maxNodes.description).toContain('(optional)');
  });

  it('strictRequired (cloud default) makes createGraph require all properties', () => {
    const createGraph = getToolDefinitions().find(t => t.name === 'createGraph');
    // Default (strict) path — big-model behavior must not regress
    const [normalized] = normalizeTools([createGraph]);
    const req = new Set(normalized.function.parameters.required || []);
    expect(req.has('name')).toBe(true);
    // Optional props are forced required under the strict path
    expect(req.size).toBeGreaterThan(1);
    expect(req.has('color')).toBe(true);
  });

  it('strictRequired:false (local/small) preserves honest required arrays', () => {
    const createGraph = getToolDefinitions().find(t => t.name === 'createGraph');
    const [normalized] = normalizeTools([createGraph], { strictRequired: false });
    // Only the genuinely-required param survives on the wire for local models
    expect(normalized.function.parameters.required).toEqual(['name']);
  });

  it('zero optional properties after full pipeline across all tools', () => {
    const tools = getToolDefinitions();
    let totalOptionals = 0;

    for (const t of tools) {
      const params = JSON.parse(JSON.stringify(t.parameters || {}));
      stripEmptyRequired(params);
      condenseSchema(params);
      flattenDeepNesting(params);
      makeAllRequired(params);

      const reqSet = new Set(params.required || []);
      const optionals = Object.keys(params.properties || {}).filter(k => !reqSet.has(k));
      totalOptionals += optionals.length;
    }

    expect(totalOptionals).toBe(0);
  });

  it('no arrays-of-objects remain after flattening across all tools', () => {
    const tools = getToolDefinitions();

    for (const t of tools) {
      const params = JSON.parse(JSON.stringify(t.parameters || {}));
      stripEmptyRequired(params);
      condenseSchema(params);
      flattenDeepNesting(params);

      for (const [key, prop] of Object.entries(params.properties || {})) {
        if (prop.type === 'array' && prop.items?.type === 'object' && prop.items.properties) {
          throw new Error(`Tool "${t.name}" still has array-of-objects: "${key}"`);
        }
      }
    }
  });

  it('no nullable properties after pipeline across all tools', () => {
    const tools = getToolDefinitions();

    for (const t of tools) {
      const params = JSON.parse(JSON.stringify(t.parameters || {}));
      stripEmptyRequired(params);
      condenseSchema(params);
      flattenDeepNesting(params);
      makeAllRequired(params);

      for (const [key, prop] of Object.entries(params.properties || {})) {
        if (prop.nullable) {
          throw new Error(`Tool "${t.name}" has nullable property: "${key}"`);
        }
      }
    }
  });

  it('preserves condensed enum info in flattened array-of-objects descriptions', () => {
    const schema = {
      type: 'object',
      properties: {
        steps: {
          type: 'array',
          description: 'Array of plan steps',
          items: {
            type: 'object',
            properties: {
              description: { type: 'string', description: 'What this step does' },
              status: { type: 'string', description: 'Step status. One of: pending, in_progress, done' },
            },
            required: ['description', 'status'],
          },
        },
      },
    };

    flattenDeepNesting(schema);

    expect(schema.properties.steps.type).toBe('string');
    expect(schema.properties.steps.description).toContain('One of: pending, in_progress, done');
    expect(schema.properties.steps.description).toContain('What this step does');
  });

  it('includes nested object field details in flattened description', () => {
    const schema = {
      type: 'object',
      properties: {
        edges: {
          type: 'array',
          description: 'Array of edges',
          items: {
            type: 'object',
            properties: {
              source: { type: 'string', description: 'Source node' },
              definitionNode: {
                type: 'object',
                description: 'Connection type definition',
                properties: {
                  name: { type: 'string', description: 'Connection name' },
                  color: { type: 'string', description: 'Color hex' },
                },
              },
            },
          },
        },
      },
    };

    flattenDeepNesting(schema);

    expect(schema.properties.edges.description).toContain('Connection name');
    expect(schema.properties.edges.description).toContain('Color hex');
  });

  it('full pipeline preserves planTask status enum values in description', () => {
    const tools = getToolDefinitions();
    const planTool = tools.find(t => t.name === 'planTask');
    expect(planTool).toBeDefined();

    const params = JSON.parse(JSON.stringify(planTool.parameters));
    stripEmptyRequired(params);
    condenseSchema(params);
    flattenDeepNesting(params);
    makeAllRequired(params);

    // The flattened steps description must contain the valid status values
    expect(params.properties.steps.description).toContain('pending');
    expect(params.properties.steps.description).toContain('in_progress');
    expect(params.properties.steps.description).toContain('done');
  });
});

describe('condenseSchema recursion', () => {
  it('condenses enums in nested arrays-of-objects', () => {
    const schema = {
      type: 'object',
      properties: {
        steps: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              status: { type: 'string', enum: ['pending', 'done'] },
              substeps: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', enum: ['pending', 'done'] }
                  }
                }
              }
            }
          }
        }
      }
    };

    condenseSchema(schema);

    // Top-level enum condensed
    const stepStatus = schema.properties.steps.items.properties.status;
    expect(stepStatus.enum).toBeUndefined();
    expect(stepStatus.description).toContain('One of: pending, done');

    // Nested (substep) enum also condensed
    const subStatus = schema.properties.steps.items.properties.substeps.items.properties.status;
    expect(subStatus.enum).toBeUndefined();
    expect(subStatus.description).toContain('One of: pending, done');
  });
});

describe('selectToolsForTurn', () => {
  it('returns only tier-1 tools for empty graph state', () => {
    const tools = selectToolsForTurn({
      graphState: { graphs: [], nodePrototypes: [], activeGraphId: null },
      userMessage: 'build me a knowledge graph',
    });

    const names = tools.map(t => t.name);
    expect(names).toContain('createNode');
    expect(names).toContain('createPopulatedGraph');
    expect(names).toContain('expandGraph');
    expect(names).toContain('listTools');
    expect(names).toContain('populateDefinitionGraph');
    expect(names).toContain('switchToGraph');
    expect(names).toContain('inspectWorkspace');
    // Context-triggered tools should NOT be included
    expect(names).not.toContain('mergeNodes');
    expect(names).not.toContain('createGroup');
  });

  it('excludes planTask for the small model tier (atomic ops only)', () => {
    const tools = selectToolsForTurn({
      graphState: { graphs: [], nodePrototypes: [], activeGraphId: null },
      userMessage: 'map out all the locations in GTA San Andreas',
      modelTier: 'small',
    });

    const names = tools.map(t => t.name);
    expect(names).not.toContain('planTask');
    // Atomic build tools remain available
    expect(names).toContain('createGraph');
    expect(names).toContain('expandGraph');
    expect(names).toContain('populateDefinitionGraph');
    expect(names).toContain('sketchGraph');
  });

  it('keeps planTask available for the large model tier', () => {
    const tools = selectToolsForTurn({
      graphState: { graphs: [], nodePrototypes: [], activeGraphId: null },
      userMessage: 'build me a knowledge graph',
      modelTier: 'large',
    });

    expect(tools.map(t => t.name)).toContain('planTask');
  });

  it('always includes listTools so the LLM can discover all capabilities', () => {
    const tools = selectToolsForTurn({
      graphState: { graphs: [], nodePrototypes: [], activeGraphId: null },
      userMessage: 'hello',
    });

    const names = tools.map(t => t.name);
    expect(names).toContain('listTools');
  });

  it('includes context-triggered tools when graph has content', () => {
    const tools = selectToolsForTurn({
      graphState: {
        graphs: [{ id: 'g1', instances: [{}, {}, {}, {}, {}], edgeIds: ['e1'], groups: [{ name: 'G' }] }],
        nodePrototypes: [],
        activeGraphId: 'g1',
      },
      userMessage: 'organize these nodes',
    });

    const names = tools.map(t => t.name);
    expect(names).toContain('createGroup');
    expect(names).toContain('mergeNodes');
    expect(names).toContain('findDuplicates');
    expect(names).toContain('replaceEdges');
  });

  it('includes semantic tools when keywords match', () => {
    const tools = selectToolsForTurn({
      graphState: { graphs: [], nodePrototypes: [], activeGraphId: null },
      userMessage: 'query wikidata for climate change entities',
    });

    const names = tools.map(t => t.name);
    expect(names).toContain('querySparql');
    expect(names).toContain('discoverOrbit');
    expect(names).toContain('semanticSearch');
  });

  // linkIdentifier is gated on a mixed flag/keyword tier: the ask that creates
  // studies is the only moment they can be grounded, and the gates are frozen
  // from the state at its start, when the graph is still empty.
  it('includes linkIdentifier on an empty graph when the ask is about studies', () => {
    const tools = selectToolsForTurn({
      graphState: { graphs: [], nodePrototypes: [], activeGraphId: null },
      userMessage: 'can you map out scientific studies into a framework of human factors?',
    });

    expect(tools.map(t => t.name)).toContain('linkIdentifier');
  });

  it('includes linkIdentifier for a populated graph regardless of wording', () => {
    const tools = selectToolsForTurn({
      graphState: {
        graphs: [{ id: 'g1', instances: [{}, {}], edgeIds: [], groups: [] }],
        nodePrototypes: [],
        activeGraphId: 'g1',
      },
      userMessage: 'ground these in the record',
    });

    expect(tools.map(t => t.name)).toContain('linkIdentifier');
  });

  it('omits linkIdentifier on an empty graph with an unrelated ask', () => {
    const tools = selectToolsForTurn({
      graphState: { graphs: [], nodePrototypes: [], activeGraphId: null },
      userMessage: 'build me a graph about the solar system',
    });

    expect(tools.map(t => t.name)).not.toContain('linkIdentifier');
  });

  it('includes tabular tools when hasTabularData is true', () => {
    const tools = selectToolsForTurn({
      graphState: { graphs: [], nodePrototypes: [], activeGraphId: null },
      userMessage: 'import the csv',
      hasTabularData: true,
    });

    const names = tools.map(t => t.name);
    expect(names).toContain('analyzeTabularData');
    expect(names).toContain('importTabularAsGraph');
  });

  it('excludes tabular tools when hasTabularData is false', () => {
    const tools = selectToolsForTurn({
      graphState: { graphs: [], nodePrototypes: [], activeGraphId: null },
      userMessage: 'import the csv',
      hasTabularData: false,
    });

    const names = tools.map(t => t.name);
    expect(names).not.toContain('analyzeTabularData');
    expect(names).not.toContain('importTabularAsGraph');
  });
});

describe('stripNulls', () => {
  it('removes null values from objects', () => {
    expect(stripNulls({ a: 1, b: null, c: 'hello' })).toEqual({ a: 1, c: 'hello' });
  });

  it('passes through non-objects unchanged', () => {
    expect(stripNulls(null)).toBe(null);
    expect(stripNulls('hello')).toBe('hello');
    expect(stripNulls([1, 2])).toEqual([1, 2]);
  });

  it('keeps empty string and zero values', () => {
    expect(stripNulls({ a: '', b: 0, c: false })).toEqual({ a: '', b: 0, c: false });
  });

  it('recursively strips nulls from nested objects', () => {
    expect(stripNulls({ a: { b: null, c: 1 } })).toEqual({ a: { c: 1 } });
  });

  it('recursively strips nulls from array items', () => {
    expect(stripNulls([{ a: null, b: 1 }, { c: null, d: 2 }])).toEqual([{ b: 1 }, { d: 2 }]);
  });

  it('handles deeply nested arrays and objects', () => {
    const input = { items: [{ nested: { val: null, keep: 'yes' } }] };
    expect(stripNulls(input)).toEqual({ items: [{ nested: { keep: 'yes' } }] });
  });
});

describe('deepParseJsonStrings', () => {
  it('parses JSON object strings', () => {
    const result = deepParseJsonStrings('{"name": "test", "value": 42}');
    expect(result).toEqual({ name: 'test', value: 42 });
  });

  it('parses JSON array strings', () => {
    const result = deepParseJsonStrings('[1, 2, 3]');
    expect(result).toEqual([1, 2, 3]);
  });

  it('parses JSON array-of-objects strings', () => {
    const result = deepParseJsonStrings('[{"name":"A"},{"name":"B"}]');
    expect(result).toEqual([{ name: 'A' }, { name: 'B' }]);
  });

  it('recursively parses nested JSON strings', () => {
    const input = {
      name: 'test',
      mapping: '{"nodeNameColumn": "name", "groupByColumn": "dept"}',
    };
    const result = deepParseJsonStrings(input);
    expect(result.mapping).toEqual({ nodeNameColumn: 'name', groupByColumn: 'dept' });
  });

  it('leaves non-JSON strings untouched', () => {
    expect(deepParseJsonStrings('hello world')).toBe('hello world');
  });
});

describe('listTools', () => {
  it('returns a catalog with all tool names', () => {
    const result = listTools({}, {});
    expect(result.catalog).toContain('Things (Nodes)');
    expect(result.catalog).toContain('Webs (Graphs)');
    expect(result.catalog).toContain('Connections (Edges)');
    expect(result.totalTools).toBeGreaterThan(30);
    expect(result.allToolNames).toContain('createNode');
    expect(result.allToolNames).toContain('listTools');
  });

  it('includes all tools from getToolDefinitions', () => {
    const result = listTools({}, {});
    const allDefs = getToolDefinitions();
    expect(result.totalTools).toBe(allDefs.length);
    for (const def of allDefs) {
      expect(result.allToolNames).toContain(def.name);
    }
  });

  it('sets _unlockAllTools on graphState', () => {
    const graphState = {};
    listTools({}, graphState);
    expect(graphState._unlockAllTools).toBe(true);
  });

  it('unlocks all tools in selectToolsForTurn after listTools is called', () => {
    const graphState = { graphs: [], nodePrototypes: [], activeGraphId: null };

    // Before unlock: tier-2/3 tools excluded
    const before = selectToolsForTurn({ graphState, userMessage: 'hello' });
    const beforeNames = before.map(t => t.name);
    expect(beforeNames).not.toContain('mergeNodes');
    expect(beforeNames).not.toContain('querySparql');

    // Call listTools to unlock
    listTools({}, graphState);

    // After unlock: all tools included
    const after = selectToolsForTurn({ graphState, userMessage: 'hello' });
    const afterNames = after.map(t => t.name);
    expect(afterNames).toContain('mergeNodes');
    expect(afterNames).toContain('querySparql');
    expect(afterNames).toContain('createGroup');
    expect(after.length).toBe(getToolDefinitions().length);
  });
});

describe('applyHistoryCacheBreakpoints', () => {
  const user = (text) => ({ role: 'user', content: text });
  const assistant = (text) => ({ role: 'assistant', content: [{ type: 'text', text }] });
  const volatile = (text) => ({ role: 'user', content: text, _volatile: true });

  const anchoredIndices = (msgs) =>
    msgs.reduce((acc, m, i) => {
      const blocks = Array.isArray(m.content) ? m.content : [];
      if (blocks.some(b => b.cache_control)) acc.push(i);
      return acc;
    }, []);

  it('places two rolling breakpoints on the cacheable history', () => {
    const msgs = [user('a'), assistant('b'), user('c'), assistant('d'), user('e'), assistant('f')];
    const out = applyHistoryCacheBreakpoints(msgs, 4);
    // Newest cacheable message plus one `lookback` behind it — the older entry
    // keeps the previous request's prefix readable while the newer extends it.
    expect(anchoredIndices(out)).toEqual([1, 5]);
  });

  // An entry anchored to the volatile block could only ever be written, never
  // read, and cache writes cost 1.25x — strictly worse than leaving it uncached.
  it('never anchors a breakpoint at or after the volatile tail', () => {
    const msgs = [user('a'), assistant('b'), user('c'), volatile('CURRENT STATE')];
    const out = applyHistoryCacheBreakpoints(msgs, 4);
    const anchors = anchoredIndices(out);
    expect(anchors.every(i => i < 3)).toBe(true);
    expect(anchors).toContain(2);
  });

  it('skips breakpoints entirely when there is no history worth caching', () => {
    const out = applyHistoryCacheBreakpoints([volatile('CURRENT STATE')]);
    expect(anchoredIndices(out)).toEqual([]);
  });

  it('collapses to a single breakpoint when history is shorter than the lookback', () => {
    const msgs = [user('a'), assistant('b')];
    const out = applyHistoryCacheBreakpoints(msgs, 4);
    expect(anchoredIndices(out)).toEqual([1]);
  });

  it('anchors on the LAST content block so the whole message is covered', () => {
    const msgs = [
      user('a'),
      { role: 'assistant', content: [{ type: 'text', text: 'x' }, { type: 'text', text: 'y' }] }
    ];
    const out = applyHistoryCacheBreakpoints(msgs, 4);
    expect(out[1].content[0].cache_control).toBeUndefined();
    expect(out[1].content[1].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('strips internal bookkeeping fields the API would reject', () => {
    const out = applyHistoryCacheBreakpoints([user('a'), assistant('b'), volatile('c')]);
    expect(out.every(m => !('_volatile' in m))).toBe(true);
  });

  it('does not mutate the input messages', () => {
    const msgs = [user('a'), assistant('b'), user('c')];
    const snapshot = JSON.parse(JSON.stringify(msgs));
    applyHistoryCacheBreakpoints(msgs, 4);
    expect(msgs).toEqual(snapshot);
  });

  // Four is the hard provider limit: tools + system + these two.
  it('uses no more than two message breakpoints however long the history', () => {
    const msgs = Array.from({ length: 40 }, (_, i) => (i % 2 ? assistant(`a${i}`) : user(`u${i}`)));
    const out = applyHistoryCacheBreakpoints(msgs, 4);
    expect(anchoredIndices(out).length).toBeLessThanOrEqual(2);
  });
});

describe('OpenRouter prompt caching', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  const run = async (model, messages) => {
    global.fetch.mockResolvedValue(createMockFetchResponse(['data: [DONE]']));
    for await (const _ of streamLLM(messages, [], { provider: 'openrouter', model, apiKey: 'k' })) { /* drain */ }
    return JSON.parse(global.fetch.mock.calls[0][1].body);
  };

  // OpenRouter caches automatically for OpenAI-family models but NOT for
  // Anthropic ones, which need the same explicit breakpoints the native API
  // wants. The default model here is Anthropic, so "it's automatic" meant the
  // whole ~28k fixed prefix was billed on every single iteration.
  it('marks the system message for caching on Anthropic models', async () => {
    const payload = await run('anthropic/claude-3.5-sonnet', [
      { role: 'system', content: 'BIG STATIC PROMPT' },
      { role: 'user', content: 'hi' }
    ]);
    expect(Array.isArray(payload.messages[0].content)).toBe(true);
    expect(payload.messages[0].content[0].cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
    expect(payload.messages[0].content[0].text).toBe('BIG STATIC PROMPT');
  });

  it('leaves models that cache automatically untouched', async () => {
    const payload = await run('openai/gpt-4o', [
      { role: 'system', content: 'BIG STATIC PROMPT' },
      { role: 'user', content: 'hi' }
    ]);
    expect(payload.messages[0].content).toBe('BIG STATIC PROMPT');
  });

  it('does not mark non-system messages', async () => {
    const payload = await run('anthropic/claude-3.5-sonnet', [
      { role: 'system', content: 'S' },
      { role: 'user', content: 'hi' }
    ]);
    expect(payload.messages[1].content).toBe('hi');
  });

  // cachePrefix had no underscore, so stripInternalFields kept it — shipping a
  // full duplicate of the ~54KB system prompt as an unrecognised property on
  // every OpenRouter and OpenAI request.
  it('never leaks the internal cache-prefix field to the provider', async () => {
    const payload = await run('anthropic/claude-3.5-sonnet', [
      { role: 'system', content: 'S', _cachePrefix: 'S' },
      { role: 'user', content: 'hi', _volatileContext: true }
    ]);
    expect(payload.messages[0]._cachePrefix).toBeUndefined();
    expect(payload.messages[0].cachePrefix).toBeUndefined();
    expect(payload.messages[1]._volatileContext).toBeUndefined();
  });
});

describe('normalizeOpenAIUsage cache accounting', () => {
  it('reads cache writes rather than assuming zero', async () => {
    global.fetch = vi.fn().mockResolvedValue(createMockFetchResponse([
      'data: {"choices":[],"usage":{"prompt_tokens":30000,"completion_tokens":100,"prompt_tokens_details":{"cached_tokens":25000,"cache_write_tokens":4000}}}',
      'data: [DONE]'
    ]));

    const chunks = [];
    for await (const c of streamLLM([{ role: 'user', content: 'hi' }], [], { provider: 'openrouter', apiKey: 'k' })) {
      chunks.push(c);
    }
    const usage = chunks.find(c => c.type === 'usage')?.usage;
    expect(usage.cacheReadTokens).toBe(25000);
    expect(usage.cacheCreationTokens).toBe(4000);
    // Writes must not be double-counted as uncached input.
    expect(usage.uncachedPromptTokens).toBe(1000);
  });
});

describe('Gemini cache accounting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  // Gemini 2.5 caches implicitly — nothing is sent on the request side, but the
  // discount only shows up in usageMetadata.cachedContentTokenCount. Not reading
  // it meant the full prompt was charged every iteration even when Google had
  // already discounted most of it, tripping a cost ceiling never actually hit.
  it('credits cachedContentTokenCount as a cache read', async () => {
    global.fetch.mockResolvedValue(createMockFetchResponse([
      'data: {"usageMetadata":{"promptTokenCount":30000,"totalTokenCount":30500,"cachedContentTokenCount":26000}}'
    ]));

    const chunks = [];
    for await (const c of streamLLM([{ role: 'user', content: 'hi' }], [], { provider: 'google', model: 'gemini-2.5-pro', apiKey: 'k' })) {
      chunks.push(c);
    }

    const usage = chunks.find(c => c.type === 'usage')?.usage;
    expect(usage.promptTokens).toBe(30000);
    expect(usage.cacheReadTokens).toBe(26000);
    expect(usage.uncachedPromptTokens).toBe(4000);
    expect(usage.cacheCreationTokens).toBe(0);
  });

  it('reports everything uncached when nothing was cached', async () => {
    global.fetch.mockResolvedValue(createMockFetchResponse([
      'data: {"usageMetadata":{"promptTokenCount":5000,"totalTokenCount":5200}}'
    ]));

    const chunks = [];
    for await (const c of streamLLM([{ role: 'user', content: 'hi' }], [], { provider: 'google', model: 'gemini-2.5-pro', apiKey: 'k' })) {
      chunks.push(c);
    }
    const usage = chunks.find(c => c.type === 'usage')?.usage;
    expect(usage.cacheReadTokens).toBe(0);
    expect(usage.uncachedPromptTokens).toBe(5000);
  });
});
