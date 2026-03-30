/**
 * Tests for LLMClient
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { streamLLM, _makeAllRequired as makeAllRequired, _flattenDeepNesting as flattenDeepNesting, _stripNulls as stripNulls, _deepParseJsonStrings as deepParseJsonStrings, _condenseSchema as condenseSchema, _stripEmptyRequired as stripEmptyRequired } from './LLMClient.js';
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
