/**
 * Tests for LLMClient
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { streamLLM } from './LLMClient.js';

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
        for await (const _ of generator) {}
      }).rejects.toThrow('OpenRouter API error');
    });

    it('normalizes tools to OpenAI format', async () => {
      global.fetch.mockResolvedValue(createMockFetchResponse(['data: [DONE]']));

      const messages = [{ role: 'user', content: 'Hello' }];
      const tools = [
        { name: 'createNode', description: 'Create a node', parameters: { type: 'object' } }
      ];

      await (async () => {
        for await (const _ of streamLLM(messages, tools, { provider: 'openrouter' })) {}
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
        for await (const _ of streamLLM(messages, [])) {}
      })();

      const fetchCall = global.fetch.mock.calls[0];
      const payload = JSON.parse(fetchCall[1].body);
      expect(payload.model).toBe('anthropic/claude-3.5-sonnet');
      expect(payload.temperature).toBe(0.7);
      expect(payload.max_tokens).toBe(2000);
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
        for await (const _ of streamLLM(messages, [], { provider: 'anthropic' })) {}
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
        for await (const _ of generator) {}
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
        })) {}
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
        for await (const _ of generator) {}
      }).rejects.toThrow('Unsupported provider');
    });
  });

  describe('Edge cases', () => {
    it('handles empty tool array', async () => {
      global.fetch.mockResolvedValue(createMockFetchResponse(['data: [DONE]']));

      const messages = [{ role: 'user', content: 'Hello' }];
      
      await (async () => {
        for await (const _ of streamLLM(messages, [], { provider: 'openrouter' })) {}
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
