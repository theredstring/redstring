/**
 * LLMClient - Unified client for calling LLM APIs with streaming support
 * Supports OpenRouter (default), Anthropic, and local OpenAI-compatible APIs
 */

import apiKeyManager from '../services/apiKeyManager.js';
import { debugLogSync } from '../utils/debugLogger.js';

/**
 * Get default config if not provided
 */
function getDefaultConfig() {
  return {
    provider: 'openrouter',
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    model: 'anthropic/claude-3.5-sonnet',
    temperature: 0.7,
    maxTokens: 2000
  };
}

/**
 * Normalize tool definitions for different providers
 */
function normalizeTools(tools) {
  if (!tools || tools.length === 0) return undefined;

  return tools.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description || '',
      parameters: tool.parameters || {}
    }
  }));
}

/**
 * Stream LLM response with tool support
 * @param {Array} messages - Conversation messages
 * @param {Array} tools - Tool definitions
 * @param {Object} config - Optional config override
 * @returns {AsyncGenerator} Yields chunks with type, content, toolCalls
 */
export async function* streamLLM(messages, tools = [], config = {}) {
  const defaults = getDefaultConfig();
  const provider = config.provider || defaults.provider;
  const endpoint = config.endpoint || defaults.endpoint;
  const model = config.model || defaults.model;
  const apiKey = config.apiKey || '';
  const temperature = config.temperature ?? defaults.temperature;
  const maxTokens = config.maxTokens ?? defaults.maxTokens;

  const normalizedTools = normalizeTools(tools);

  if (provider === 'openrouter') {
    yield* streamOpenRouter(messages, normalizedTools, { endpoint, model, apiKey, temperature, maxTokens });
  } else if (provider === 'anthropic') {
    yield* streamAnthropic(messages, normalizedTools, { endpoint, model, apiKey, temperature, maxTokens });
  } else if (provider === 'openai' || provider === 'local') {
    yield* streamOpenAI(messages, normalizedTools, { endpoint, model, apiKey, temperature, maxTokens });
  } else {
    throw new Error(`Unsupported provider: ${provider}`);
  }
}

/**
 * Stream from OpenRouter API
 */
async function* streamOpenRouter(messages, tools, { endpoint, model, apiKey, temperature, maxTokens }) {
  const payload = {
    model,
    messages,
    ...(tools && tools.length > 0 ? { tools, tool_choice: 'auto' } : {}),
    max_tokens: maxTokens,
    temperature,
    stream: true
  };

  // #region agent log
  debugLogSync('LLMClient.js:streamOpenRouter:REQUEST', 'Sending request to OpenRouter', { model, toolCount: tools?.length || 0, hasTools: !!tools, messageCount: messages?.length }, 'debug-session', 'F');
  // #endregion

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://redstring.io',
      'X-Title': 'Redstring Knowledge Graph'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenRouter API error (${response.status}): ${errorText}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let currentToolCall = null;
  let toolCallIndex = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') continue;

          try {
            const chunk = JSON.parse(data);
            const choice = chunk.choices?.[0];
            if (!choice) continue;

            const delta = choice.delta;

            // #region agent log
            if (delta?.tool_calls || delta?.content) {
              debugLogSync('LLMClient.js:streamOpenRouter:DELTA', 'Received delta', { hasToolCalls: !!delta?.tool_calls, hasContent: !!delta?.content, contentPreview: delta?.content?.substring?.(0, 100), finishReason: choice.finish_reason }, 'debug-session', 'G');
            }
            // #endregion

            // Tool calls
            if (delta?.tool_calls) {
              for (const toolCall of delta.tool_calls) {
                const index = toolCall.index ?? 0;
                if (!currentToolCall || currentToolCall.index !== index) {
                  if (currentToolCall) {
                    console.log('[LLMClient:OpenRouter] Yielding tool_call (transition):', currentToolCall.function?.name);
                    yield {
                      type: 'tool_call',
                      name: currentToolCall.function?.name,
                      args: JSON.parse(currentToolCall.function?.arguments || '{}'),
                      id: currentToolCall.id
                    };
                  }
                  currentToolCall = { index, id: toolCall.id, function: { name: '', arguments: '' } };
                }
                if (toolCall.function?.name) {
                  currentToolCall.function.name = toolCall.function.name;
                }
                if (toolCall.function?.arguments) {
                  currentToolCall.function.arguments += toolCall.function.arguments;
                }
                if (toolCall.id) {
                  currentToolCall.id = toolCall.id;
                }
              }
            }

            // Text content
            if (delta?.content) {
              console.log('[LLMClient:OpenRouter] Text delta:', JSON.stringify(delta.content));
              yield { type: 'text', content: delta.content };
            }

            // Finish tool call if done
            if (choice.finish_reason === 'tool_calls' && currentToolCall) {
              console.log('[LLMClient:OpenRouter] Yielding tool_call (finish):', currentToolCall.function?.name);

              let parsedArgs = {};
              try {
                parsedArgs = JSON.parse(currentToolCall.function?.arguments || '{}');
              } catch (e) {
                console.warn('[LLMClient:OpenRouter] Failed to parse finished tool args:', e);
                parsedArgs = { error: 'The spell was cut short! (Response truncated)' };
              }

              yield {
                type: 'tool_call',
                name: currentToolCall.function?.name,
                args: parsedArgs,
                id: currentToolCall.id
              };
              currentToolCall = null;
            }
          } catch (e) {
            // Skip malformed JSON
            continue;
          }
        }
      }
    }

    // Flush remaining tool call
    if (currentToolCall) {
      console.log('[LLMClient:OpenRouter] Yielding tool_call (flush):', currentToolCall.function?.name);
      // #region agent log
      debugLogSync('LLMClient.js:streamOpenRouter:TOOL_CALL_FLUSH', 'Flushing tool call', { name: currentToolCall.function?.name, hasArgs: !!currentToolCall.function?.arguments }, 'debug-session', 'H');
      // #endregion

      let parsedArgs = {};
      try {
        parsedArgs = JSON.parse(currentToolCall.function?.arguments || '{}');
      } catch (e) {
        console.warn('[LLMClient:OpenRouter] Failed to parse flushed tool args (likely truncated):', e);
        // Return a special error result that the UI can handle gracefully
        parsedArgs = { error: 'The spell was cut short! (Response truncated)' };
      }

      yield {
        type: 'tool_call',
        name: currentToolCall.function?.name,
        args: parsedArgs,
        id: currentToolCall.id
      };
    }
  } finally {
    reader.releaseLock();
  }
}

// #region agent log - end of streamOpenRouter
debugLogSync('LLMClient.js:MODULE_LOADED', 'LLMClient module loaded', {}, 'debug-session', 'F');
// #endregion

/**
 * Stream from Anthropic API
 */
async function* streamAnthropic(messages, tools, { endpoint, model, apiKey, temperature, maxTokens }) {
  // Anthropic uses a different message format
  const systemMessage = messages.find(m => m.role === 'system');
  const conversationMessages = messages.filter(m => m.role !== 'system');

  const payload = {
    model,
    max_tokens: maxTokens,
    system: systemMessage?.content || '',
    messages: conversationMessages,
    ...(tools && tools.length > 0 ? { tools } : {}),
    temperature,
    stream: true
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API error (${response.status}): ${errorText}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let currentToolCall = null;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') continue;

          try {
            const chunk = JSON.parse(data);

            // Text content
            if (chunk.type === 'content_block_delta' && chunk.delta?.type === 'text') {
              yield { type: 'text', content: chunk.delta.text };
            }

            // Tool use start
            if (chunk.type === 'content_block_start' && chunk.content_block?.type === 'tool_use') {
              currentToolCall = {
                id: chunk.content_block.id,
                name: chunk.content_block.name,
                input: {}
              };
            }

            // Tool use delta
            if (chunk.type === 'content_block_delta' && chunk.delta?.type === 'input_json_delta') {
              if (currentToolCall) {
                // Accumulate JSON input
                const partial = chunk.delta.partial_json || '';
                try {
                  currentToolCall.input = JSON.parse(partial);
                } catch {
                  // Partial JSON, will complete later
                }
              }
            }

            // Tool use stop
            if (chunk.type === 'content_block_stop' && currentToolCall) {
              yield {
                type: 'tool_call',
                name: currentToolCall.name,
                args: currentToolCall.input,
                id: currentToolCall.id
              };
              currentToolCall = null;
            }
          } catch (e) {
            continue;
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Stream from OpenAI-compatible API (OpenAI, Ollama, etc.)
 */
async function* streamOpenAI(messages, tools, { endpoint, model, apiKey, temperature, maxTokens }) {
  const payload = {
    model,
    messages,
    ...(tools && tools.length > 0 ? { tools, tool_choice: 'auto' } : {}),
    max_tokens: maxTokens,
    temperature,
    stream: true
  };

  const headers = {
    'Content-Type': 'application/json'
  };

  if (apiKey && apiKey !== 'local' && apiKey.trim() !== '') {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    if (endpoint?.includes('localhost') || endpoint?.includes('127.0.0.1')) {
      throw new Error(`Local LLM server error: ${errorText}. Is the server running?`);
    }
    throw new Error(`OpenAI API error (${response.status}): ${errorText}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let currentToolCall = null;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') continue;

          try {
            const chunk = JSON.parse(data);
            const choice = chunk.choices?.[0];
            if (!choice) continue;

            const delta = choice.delta;

            // Tool calls
            if (delta?.tool_calls) {
              for (const toolCall of delta.tool_calls) {
                const index = toolCall.index ?? 0;
                if (!currentToolCall || currentToolCall.index !== index) {
                  if (currentToolCall) {
                    yield {
                      type: 'tool_call',
                      name: currentToolCall.function?.name,
                      args: JSON.parse(currentToolCall.function?.arguments || '{}'),
                      id: currentToolCall.id
                    };
                  }
                  currentToolCall = { index, id: toolCall.id, function: { name: '', arguments: '' } };
                }
                if (toolCall.function?.name) {
                  currentToolCall.function.name = toolCall.function.name;
                }
                if (toolCall.function?.arguments) {
                  currentToolCall.function.arguments += toolCall.function.arguments;
                }
                if (toolCall.id) {
                  currentToolCall.id = toolCall.id;
                }
              }
            }

            // Text content
            if (delta?.content) {
              yield { type: 'text', content: delta.content };
            }

            // Finish tool call if done
            if (choice.finish_reason === 'tool_calls' && currentToolCall) {
              yield {
                type: 'tool_call',
                name: currentToolCall.function?.name,
                args: JSON.parse(currentToolCall.function?.arguments || '{}'),
                id: currentToolCall.id
              };
              currentToolCall = null;
            }
          } catch (e) {
            continue;
          }
        }
      }
    }

    // Flush remaining tool call
    if (currentToolCall) {
      yield {
        type: 'tool_call',
        name: currentToolCall.function?.name,
        args: JSON.parse(currentToolCall.function?.arguments || '{}'),
        id: currentToolCall.id
      };
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Call LLM without streaming (accumulates full response)
 * @param {Array} messages - Conversation messages
 * @param {Array} tools - Tool definitions
 * @param {Object} config - Optional config override
 * @returns {Promise<Object>} { content, toolCalls }
 */
export async function callLLM(messages, tools = [], config = {}) {
  let content = '';
  const toolCalls = [];
  const seenToolCallIds = new Set();

  for await (const chunk of streamLLM(messages, tools, config)) {
    if (chunk.type === 'text') {
      content += chunk.content;
    } else if (chunk.type === 'tool_call') {
      // Avoid duplicates
      if (!seenToolCallIds.has(chunk.id)) {
        toolCalls.push({
          id: chunk.id,
          name: chunk.name,
          args: chunk.args
        });
        seenToolCallIds.add(chunk.id);
      }
    }
  }

  return { content, toolCalls };
}

