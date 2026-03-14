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
    maxTokens: 8192
  };
}

/**
 * Recursively strip empty `required` arrays from JSON Schema objects.
 * Gemini may misinterpret required:[] — omitting it is safer.
 */
function stripEmptyRequired(schema) {
  if (!schema || typeof schema !== 'object') return;
  if (Array.isArray(schema.required) && schema.required.length === 0) {
    delete schema.required;
  }
  // Recurse into properties
  if (schema.properties) {
    for (const val of Object.values(schema.properties)) {
      stripEmptyRequired(val);
    }
  }
  // Recurse into items (for array schemas)
  if (schema.items) {
    stripEmptyRequired(schema.items);
  }
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
export async function* streamLLM(messages, tools = [], config = {}, signal = null) {
  const defaults = getDefaultConfig();
  const provider = config.provider || defaults.provider;
  const endpoint = config.endpoint || defaults.endpoint;
  const model = config.model || defaults.model;
  const apiKey = config.apiKey || '';
  const temperature = config.temperature ?? defaults.temperature;
  const maxTokens = config.maxTokens ?? defaults.maxTokens;

  const normalizedTools = normalizeTools(tools);

  if (provider === 'openrouter') {
    yield* streamOpenRouter(messages, normalizedTools, { endpoint, model, apiKey, temperature, maxTokens }, signal);
  } else if (provider === 'anthropic') {
    yield* streamAnthropic(messages, normalizedTools, { endpoint, model, apiKey, temperature, maxTokens }, signal);
  } else if (provider === 'openai' || provider === 'local') {
    yield* streamOpenAI(messages, normalizedTools, { endpoint, model, apiKey, temperature, maxTokens }, signal);
  } else if (provider === 'google') {
    yield* streamGemini(messages, normalizedTools, { model, apiKey, temperature, maxTokens }, signal);
  } else {
    throw new Error(`Unsupported provider: ${provider}`);
  }
}

/**
 * Stream from OpenRouter API
 */
async function* streamOpenRouter(messages, tools, { endpoint, model, apiKey, temperature, maxTokens }, signal = null) {
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
    body: JSON.stringify(payload),
    signal
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
      if (signal?.aborted) {
        reader.cancel();
        break;
      }
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
                    const tcName = currentToolCall.function?.name;
                    if (!tcName) {
                      console.error('[LLMClient:OpenRouter] Skipping tool_call with empty name at transition');
                    } else {
                      console.error('[LLMClient:OpenRouter] Yielding tool_call (transition):', tcName);

                      let parsedArgs = {};
                      try {
                        parsedArgs = JSON.parse(currentToolCall.function?.arguments || '{}');
                      } catch (e) {
                        console.warn('[LLMClient:OpenRouter] Failed to parse transition tool args:', e);
                        parsedArgs = { error: 'The spell was cut short! (Response truncated)' };
                      }

                      yield {
                        type: 'tool_call',
                        name: tcName,
                        args: parsedArgs,
                        id: currentToolCall.id
                      };
                    }
                  }
                  currentToolCall = { index, id: toolCall.id, function: { name: '', arguments: '' } };
                  yield {
                    type: 'tool_call_start',
                    id: toolCall.id,
                    name: toolCall.function?.name || ''
                  };
                }
                if (toolCall.function?.name) {
                  currentToolCall.function.name = toolCall.function.name;
                  yield {
                    type: 'tool_call_start', // Update the start event with the name once available
                    id: currentToolCall.id,
                    name: currentToolCall.function.name
                  };
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
              console.error('[LLMClient:OpenRouter] Text delta:', JSON.stringify(delta.content));
              yield { type: 'text', content: delta.content };
            }

            // Finish tool call if done
            if (choice.finish_reason === 'tool_calls' && currentToolCall) {
              const tcName = currentToolCall.function?.name;
              if (!tcName) {
                console.error('[LLMClient:OpenRouter] Skipping tool_call with empty name at finish');
              } else {
                console.error('[LLMClient:OpenRouter] Yielding tool_call (finish):', tcName);

                let parsedArgs = {};
                try {
                  parsedArgs = JSON.parse(currentToolCall.function?.arguments || '{}');
                } catch (e) {
                  console.warn('[LLMClient:OpenRouter] Failed to parse finished tool args:', e);
                  parsedArgs = { error: 'The spell was cut short! (Response truncated)' };
                }

                yield {
                  type: 'tool_call',
                  name: tcName,
                  args: parsedArgs,
                  id: currentToolCall.id
                };
              }
              currentToolCall = null;
            }
          } catch (e) {
            console.error('[LLMClient:OpenRouter] Malformed JSON chunk skipped:', e.message);
            continue;
          }
        }
      }
    }

    // Flush remaining tool call
    if (currentToolCall) {
      const tcName = currentToolCall.function?.name;
      // #region agent log
      debugLogSync('LLMClient.js:streamOpenRouter:TOOL_CALL_FLUSH', 'Flushing tool call', { name: tcName, hasArgs: !!currentToolCall.function?.arguments }, 'debug-session', 'H');
      // #endregion

      if (!tcName) {
        console.error('[LLMClient:OpenRouter] Skipping tool_call with empty name at flush');
      } else {
        console.error('[LLMClient:OpenRouter] Yielding tool_call (flush):', tcName);

        let parsedArgs = {};
        try {
          parsedArgs = JSON.parse(currentToolCall.function?.arguments || '{}');
        } catch (e) {
          console.warn('[LLMClient:OpenRouter] Failed to parse flushed tool args (likely truncated):', e);
          parsedArgs = { error: 'The spell was cut short! (Response truncated)' };
        }

        yield {
          type: 'tool_call',
          name: tcName,
          args: parsedArgs,
          id: currentToolCall.id
        };
      }
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
async function* streamAnthropic(messages, tools, { endpoint, model, apiKey, temperature, maxTokens }, signal = null) {
  // Anthropic uses a different message format
  const systemMessage = messages.find(m => m.role === 'system');
  
  // Transform OpenAI-style messages to Anthropic format
  const conversationMessages = [];
  for (const msg of messages) {
    if (msg.role === 'system') continue;

    if (msg.role === 'assistant') {
      const content = [];
      if (typeof msg.content === 'string' && msg.content) {
        content.push({ type: 'text', text: msg.content });
      }
      if (Array.isArray(msg.tool_calls)) {
        for (const tc of msg.tool_calls) {
          const fnName = tc.function?.name || tc.name || '';
          let fnArgs = {};
          try { fnArgs = JSON.parse(tc.function?.arguments || '{}'); } catch { fnArgs = tc.args || {}; }
          content.push({
            type: 'tool_use',
            id: tc.id,
            name: fnName,
            input: fnArgs
          });
        }
      }
      if (content.length > 0) {
        conversationMessages.push({ role: 'assistant', content });
      }
    } else if (msg.role === 'tool') {
      // Tool results are user messages with tool_result blocks
      let resultObj = {};
      try { resultObj = JSON.parse(msg.content || '{}'); } catch { resultObj = { result: msg.content }; }
      conversationMessages.push({
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: msg.tool_call_id,
          content: JSON.stringify(resultObj)
        }]
      });
    } else {
      // User message
      conversationMessages.push({ role: 'user', content: msg.content });
    }
  }

  const payload = {
    model: model || 'claude-3-5-sonnet-20241022',
    max_tokens: maxTokens || 8192,
    system: systemMessage?.content || '',
    messages: conversationMessages,
    ...(tools && tools.length > 0 ? { tools } : {}),
    temperature: temperature ?? 0.7,
    stream: true
  };

  const response = await fetch(endpoint || 'https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(payload),
    signal
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API error (${response.status}): ${errorText}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let currentToolCall = null;
  let toolArgsBuffer = '';

  try {
    while (true) {
      if (signal?.aborted) {
        reader.cancel();
        break;
      }
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
                name: chunk.content_block.name
              };
              toolArgsBuffer = '';
              yield {
                type: 'tool_call_start',
                id: currentToolCall.id,
                name: currentToolCall.name
              };
            }

            // Tool use delta (accumulate parameters)
            if (chunk.type === 'content_block_delta' && chunk.delta?.type === 'input_json_delta') {
              if (currentToolCall) {
                toolArgsBuffer += chunk.delta.partial_json || '';
              }
            }

            // Tool use stop
            if (chunk.type === 'content_block_stop' && currentToolCall) {
              const tcName = currentToolCall.name;
              if (!tcName) {
                console.error('[LLMClient:Anthropic] Skipping tool_call with empty name');
              } else {
                let parsedArgs = {};
                try {
                  parsedArgs = JSON.parse(toolArgsBuffer || '{}');
                } catch (e) {
                  console.warn('[LLMClient:Anthropic] Partial/invalid JSON for tool args:', toolArgsBuffer);
                  parsedArgs = { error: 'Truncated tool arguments' };
                }
                yield {
                  type: 'tool_call',
                  name: tcName,
                  args: parsedArgs,
                  id: currentToolCall.id
                };
              }
              currentToolCall = null;
              toolArgsBuffer = '';
            }
          } catch (e) {
            console.error('[LLMClient:Anthropic] Malformed JSON chunk skipped:', e.message);
            continue;
          }
        }
      }
    }

    // Flush pending tool call if stream ended without content_block_stop
    if (currentToolCall) {
      const tcName = currentToolCall.name;
      if (!tcName) {
        console.error('[LLMClient:Anthropic] Skipping pending tool_call with empty name at flush');
      } else {
        console.error('[LLMClient:Anthropic] Flushing pending tool_call at stream end:', tcName);
        let parsedArgs = {};
        try {
          parsedArgs = JSON.parse(toolArgsBuffer || '{}');
        } catch (e) {
          console.warn('[LLMClient:Anthropic] Partial/invalid JSON for flushed tool args:', toolArgsBuffer);
          parsedArgs = { error: 'Truncated tool arguments' };
        }
        yield {
          type: 'tool_call',
          name: tcName,
          args: parsedArgs,
          id: currentToolCall.id
        };
      }
      currentToolCall = null;
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Stream from OpenAI-compatible API (OpenAI, Ollama, etc.)
 */
async function* streamOpenAI(messages, tools, { endpoint, model, apiKey, temperature, maxTokens }, signal = null) {
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
    body: JSON.stringify(payload),
    signal
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
      if (signal?.aborted) {
        reader.cancel();
        break;
      }
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
                    const tcName = currentToolCall.function?.name;
                    if (!tcName) {
                      console.error('[LLMClient:OpenAI] Skipping tool_call with empty name at transition');
                    } else {
                      let parsedArgs = {};
                      try {
                        parsedArgs = JSON.parse(currentToolCall.function?.arguments || '{}');
                      } catch (e) {
                        console.warn('[LLMClient:OpenAI] Failed to parse transition tool args:', e);
                        parsedArgs = { error: 'The spell was cut short! (Response truncated)' };
                      }

                      yield {
                        type: 'tool_call',
                        name: tcName,
                        args: parsedArgs,
                        id: currentToolCall.id
                      };
                    }
                  }
                  currentToolCall = { index, id: toolCall.id, function: { name: '', arguments: '' } };
                  yield {
                    type: 'tool_call_start',
                    id: toolCall.id,
                    name: toolCall.function?.name || ''
                  };
                }
                if (toolCall.function?.name) {
                  currentToolCall.function.name = toolCall.function.name;
                  yield {
                    type: 'tool_call_start',
                    id: currentToolCall.id,
                    name: currentToolCall.function.name
                  };
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
              const tcName = currentToolCall.function?.name;
              if (!tcName) {
                console.error('[LLMClient:OpenAI] Skipping tool_call with empty name at finish');
              } else {
                let parsedArgs = {};
                try {
                  parsedArgs = JSON.parse(currentToolCall.function?.arguments || '{}');
                } catch (e) {
                  console.warn('[LLMClient:OpenAI] Failed to parse finished tool args:', e);
                  parsedArgs = { error: 'The spell was cut short! (Response truncated)' };
                }

                yield {
                  type: 'tool_call',
                  name: tcName,
                  args: parsedArgs,
                  id: currentToolCall.id
                };
              }
              currentToolCall = null;
            }
          } catch (e) {
            console.error('[LLMClient:OpenAI] Malformed JSON chunk skipped:', e.message);
            continue;
          }
        }
      }
    }

    // Flush remaining tool call
    if (currentToolCall) {
      const tcName = currentToolCall.function?.name;
      if (!tcName) {
        console.error('[LLMClient:OpenAI] Skipping tool_call with empty name at flush');
      } else {
        let parsedArgs = {};
        try {
          parsedArgs = JSON.parse(currentToolCall.function?.arguments || '{}');
        } catch (e) {
          console.warn('[LLMClient:OpenAI] Failed to parse flushed tool args:', e);
          parsedArgs = { error: 'The spell was cut short! (Response truncated)' };
        }

        yield {
          type: 'tool_call',
          name: tcName,
          args: parsedArgs,
          id: currentToolCall.id
        };
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Stream from Google Gemini API
 * Uses the Gemini generateContent (streaming) REST endpoint.
 * Gemini has its own message/tool format — not OpenAI-compatible.
 */
async function* streamGemini(messages, tools, { model, apiKey, temperature, maxTokens }, signal = null) {
  // Convert OpenAI-style messages to Gemini contents format
  const systemParts = [];
  const contents = [];
  // Map tool_call_id -> function name (for pairing results with calls)
  const toolCallIdToName = new Map();

  for (const msg of messages) {
    if (msg.role === 'system') {
      // Gemini uses a separate systemInstruction field
      systemParts.push({ text: msg.content || '' });

    } else if (msg.role === 'assistant') {
      // Assistant turn: possibly has tool_calls (function calls)
      const parts = [];
      if (msg.content) parts.push({ text: msg.content });
      if (Array.isArray(msg.tool_calls)) {
        for (const tc of msg.tool_calls) {
          const fnName = tc.function?.name || tc.name || '';
          let fnArgs = {};
          try { fnArgs = JSON.parse(tc.function?.arguments || '{}'); } catch { fnArgs = tc.args || {}; }
          toolCallIdToName.set(tc.id, fnName);
          parts.push({ functionCall: { name: fnName, args: fnArgs } });
        }
      }
      if (parts.length > 0) contents.push({ role: 'model', parts });

    } else if (msg.role === 'tool') {
      // OpenAI-style tool result -> Gemini user functionResponse
      let resultObj = {};
      try { resultObj = JSON.parse(msg.content || '{}'); } catch { resultObj = { result: msg.content }; }
      const fnName = toolCallIdToName.get(msg.tool_call_id) || msg.tool_call_id || 'unknown';
      contents.push({
        role: 'user',
        parts: [{ functionResponse: { name: fnName, response: resultObj } }]
      });

    } else {
      // User message (plain string or array)
      if (Array.isArray(msg.content)) {
        const parts = [];
        for (const item of msg.content) {
          if (item.type === 'text') parts.push({ text: item.text || '' });
        }
        if (parts.length > 0) contents.push({ role: 'user', parts });
      } else {
        contents.push({ role: 'user', parts: [{ text: msg.content || '' }] });
      }
    }
  }

  // Convert tool definitions to Gemini functionDeclarations format
  let geminiTools = undefined;
  if (tools && tools.length > 0) {
    geminiTools = [{
      functionDeclarations: tools.map(t => {
        const params = JSON.parse(JSON.stringify(
          t.function?.parameters || t.parameters || { type: 'object', properties: {} }
        ));
        // Strip empty required arrays — Gemini may misinterpret required:[] as "all required"
        stripEmptyRequired(params);
        return {
          name: t.function?.name || t.name,
          description: t.function?.description || t.description || '',
          parameters: params
        };
      })
    }];
  }

  const effectiveModel = model || 'gemini-2.5-flash';
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${effectiveModel}:streamGenerateContent?alt=sse&key=${apiKey}`;

  const payload = {
    contents,
    ...(systemParts.length > 0 ? { systemInstruction: { parts: systemParts } } : {}),
    ...(geminiTools ? { tools: geminiTools } : {}),
    ...(geminiTools ? { toolConfig: { functionCallingConfig: { mode: 'AUTO' } } } : {}),
    generationConfig: {
      temperature: temperature ?? 0.7,
      maxOutputTokens: maxTokens ?? 8192
    }
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Google Gemini API error (${response.status}): ${errorText}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let pendingFunctionCall = null;

  try {
    while (true) {
      if (signal?.aborted) {
        reader.cancel();
        break;
      }
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (!data || data === '[DONE]') continue;

        try {
          const chunk = JSON.parse(data);
          const candidate = chunk.candidates?.[0];
          if (!candidate) continue;

          const parts = candidate.content?.parts || [];
          for (const part of parts) {
            if (part.text) {
              yield { type: 'text', content: part.text };
            } else if (part.functionCall) {
              // Validate function call name
              const fnName = part.functionCall.name;
              if (!fnName || typeof fnName !== 'string' || fnName.trim() === '') {
                console.error('[LLMClient:Gemini] Skipping functionCall with missing/empty name:', JSON.stringify(part.functionCall));
                continue;
              }

              const fnArgs = part.functionCall.args;
              if (!fnArgs || (typeof fnArgs === 'object' && Object.keys(fnArgs).length === 0)) {
                console.error('[LLMClient:Gemini] Warning: functionCall "' + fnName + '" received with empty args');
              }

              // Flush any pending function call before starting a new one
              if (pendingFunctionCall) {
                yield {
                  type: 'tool_call',
                  name: pendingFunctionCall.name,
                  args: pendingFunctionCall.args,
                  id: pendingFunctionCall.id
                };
                pendingFunctionCall = null;
              }

              // Gemini typically returns the full function call in one chunk,
              // but accumulate in case future models stream args across chunks
              const fnId = `gemini-fn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
              yield {
                type: 'tool_call_start',
                id: fnId,
                name: fnName
              };

              if (fnArgs !== undefined) {
                // Args present — yield immediately (typical Gemini behavior)
                yield {
                  type: 'tool_call',
                  name: fnName,
                  args: fnArgs || {},
                  id: fnId
                };
              } else {
                // Args not yet available — hold for flush
                pendingFunctionCall = { id: fnId, name: fnName, args: {} };
              }
            }
          }
        } catch (e) {
          console.error('[LLMClient:Gemini] Malformed JSON chunk skipped:', e.message, '| Data:', (data || '').substring(0, 300));
          continue;
        }
      }
    }

    // Flush any remaining pending function call
    if (pendingFunctionCall) {
      console.error('[LLMClient:Gemini] Flushing pending functionCall at stream end:', pendingFunctionCall.name);
      yield {
        type: 'tool_call',
        name: pendingFunctionCall.name,
        args: pendingFunctionCall.args,
        id: pendingFunctionCall.id
      };
      pendingFunctionCall = null;
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
export async function callLLM(messages, tools = [], config = {}, signal = null) {
  let content = '';
  const toolCalls = [];
  const seenToolCallIds = new Set();

  for await (const chunk of streamLLM(messages, tools, config, signal)) {
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

