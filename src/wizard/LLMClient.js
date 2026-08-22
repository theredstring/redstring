/**
 * LLMClient - Unified client for calling LLM APIs with streaming support
 * Supports OpenRouter (default), Anthropic, and local OpenAI-compatible APIs
 */

import { debugLogSync } from '../utils/debugLogger.js';
import { isVolatileContextMessage } from './requestMessages.js';

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
 * Build a concise field summary that preserves descriptions (which contain
 * condensed enum info from condenseSchema) and recursively summarizes
 * nested objects and arrays-of-objects.
 */
function summarizeFields(properties) {
  return Object.entries(properties)
    .map(([k, v]) => {
      // Nested object with its own properties — show inner fields
      if (v.type === 'object' && v.properties) {
        const inner = Object.entries(v.properties)
          .map(([ik, iv]) => iv.description ? `${ik}: ${iv.description}` : `${ik} (${iv.type})`)
          .join('; ');
        return `${k}: object with {${inner}}`;
      }
      // Nested array-of-objects — show inner item fields
      if (v.type === 'array' && v.items?.type === 'object' && v.items.properties) {
        const inner = Object.entries(v.items.properties)
          .map(([ik, iv]) => iv.description ? `${ik}: ${iv.description}` : `${ik} (${iv.type})`)
          .join('; ');
        return `${k}: array of {${inner}}`;
      }
      // Use description (includes condensed enum info) when available
      if (v.description) return `${k}: ${v.description}`;
      return `${k} (${v.type})`;
    })
    .join('; ');
}

/**
 * Flatten deeply nested object properties (objects containing arrays-of-objects
 * or nested objects) to JSON strings. This reduces structural complexity for
 * all LLM providers.
 */
function flattenDeepNesting(schema) {
  if (!schema?.properties) return;
  for (const [key, prop] of Object.entries(schema.properties)) {
    // Flatten arrays-of-objects → JSON string
    if (prop.type === 'array' && prop.items?.type === 'object' && prop.items.properties) {
      const fields = summarizeFields(prop.items.properties);
      schema.properties[key] = {
        type: 'string',
        description: `${prop.description || ''} (JSON array of objects with: ${fields})`.trim()
      };
      continue;
    }
    // Flatten objects containing deep nesting
    if (prop.type === 'object' && prop.properties) {
      const hasDeepNesting = Object.values(prop.properties).some(
        sub => (sub.type === 'array' && sub.items?.type === 'object') ||
               (sub.type === 'object' && sub.properties)
      );
      if (hasDeepNesting) {
        const fields = summarizeFields(prop.properties);
        schema.properties[key] = {
          type: 'string',
          description: `${prop.description || ''} (JSON object with fields: ${fields})`.trim()
        };
      } else {
        flattenDeepNesting(prop);
      }
    }
  }
}

/**
 * Make all properties required, marking previously-optional ones with
 * "(optional)" in their description. This gives every property exactly
 * 1 state (eliminating 2^N branching from optionals/nullables) while
 * clearly communicating which params are truly needed vs nice-to-have.
 */
function makeAllRequired(schema) {
  if (!schema?.properties) return;
  const originalRequired = new Set(schema.required || []);

  for (const [key, prop] of Object.entries(schema.properties)) {
    if (!originalRequired.has(key)) {
      prop.description = ((prop.description || '') + ' (optional)').trim();
    }
    if (prop.type === 'object' && prop.properties) {
      makeAllRequired(prop);
    }
    if (prop.type === 'array' && prop.items?.type === 'object' && prop.items.properties) {
      makeAllRequired(prop.items);
    }
  }

  schema.required = Object.keys(schema.properties);
}

/**
 * Strip null values from tool call arguments.
 * Nullable schema properties let LLMs pass null for unused params;
 * this removes them before the args reach tool functions.
 */
function stripNulls(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(stripNulls);
  const result = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== null) result[k] = (typeof v === 'object') ? stripNulls(v) : v;
  }
  return result;
}

/**
 * Normalize an OpenAI-format `usage` object (OpenRouter / OpenAI / local) into
 * the provider-agnostic { promptTokens, completionTokens, totalTokens } shape
 * the agent loop accumulates. Returns null if no usage is present.
 */
function normalizeOpenAIUsage(usage) {
  if (!usage) return null;
  const promptTokens = usage.prompt_tokens || 0;
  const completionTokens = usage.completion_tokens || 0;
  const totalTokens = usage.total_tokens || (promptTokens + completionTokens);
  // OpenAI and OpenRouter report cache hits under prompt_tokens_details.
  //
  // Caching is automatic for OpenAI-family models, but NOT for Anthropic models
  // reached through OpenRouter — those need the same explicit `cache_control`
  // breakpoints the native API wants (see withOpenRouterCaching). Assuming it was
  // automatic for everything is why the default configuration paid full price for
  // a ~28k-token prefix on every iteration.
  const details = usage.prompt_tokens_details || {};
  const cacheReadTokens = details.cached_tokens || 0;
  // Writes bill at 1.25x. Folding them into `uncachedPromptTokens` under-reports
  // real cost by ~25% on every iteration that populates the cache.
  const cacheCreationTokens = details.cache_write_tokens || details.cache_creation_tokens || 0;
  return {
    promptTokens,
    completionTokens,
    totalTokens,
    uncachedPromptTokens: Math.max(0, promptTokens - cacheReadTokens - cacheCreationTokens),
    cacheReadTokens,
    cacheCreationTokens
  };
}

/**
 * Reconstruct nested objects from JSON strings in Gemini function call args.
 * Gemini may return nested objects as JSON strings when schemas were simplified.
 * Also handles plain strings for object fields (wraps as { name: value }).
 */
function deepParseJsonStrings(obj) {
  if (typeof obj === 'string') {
    const trimmed = obj.trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
        (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try { return JSON.parse(trimmed); } catch { return obj; }
    }
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(deepParseJsonStrings);
  }
  if (obj && typeof obj === 'object') {
    const result = {};
    for (const [k, v] of Object.entries(obj)) {
      result[k] = deepParseJsonStrings(v);
    }
    return result;
  }
  return obj;
}

/**
 * Condense tool schemas for all providers.
 * Moves enum constraints into descriptions to reduce token count
 * without changing the structural shape of the schema.
 */
function condenseSchema(schema) {
  if (!schema || typeof schema !== 'object' || !schema.properties) return;
  for (const prop of Object.values(schema.properties)) {
    if (prop.type === 'string' && prop.enum) {
      prop.description = (prop.description || '') + `. One of: ${prop.enum.join(', ')}`;
      delete prop.enum;
    }
    if (prop.type === 'array' && prop.items?.enum) {
      prop.description = (prop.description || '') + `. Values: ${prop.items.enum.join(', ')}`;
      delete prop.items.enum;
    }
    if (prop.type === 'array' && prop.items?.type === 'object' && prop.items.properties) {
      for (const iv of Object.values(prop.items.properties)) {
        if (iv.type === 'string' && iv.enum) {
          iv.description = (iv.description || '') + `. One of: ${iv.enum.join(', ')}`;
          delete iv.enum;
        }
      }
      // Recurse into nested structures within array items (e.g. substeps inside steps)
      condenseSchema(prop.items);
    }
    if (prop.type === 'object' && prop.properties) {
      condenseSchema(prop);
    }
  }
}

/**
 * Normalize tool definitions for different providers.
 *
 * @param {Array} tools - Tool definitions
 * @param {Object} [opts]
 * @param {boolean} [opts.strictRequired=true] - When true, apply makeAllRequired()
 *   (marks every property required to collapse 2^N optional-branching — needed for
 *   OpenAI-strict / Gemini function-calling quirks). Local/small models choke on
 *   this pressure and fall out of the tool-call format into prose, so we skip it
 *   for them and let the honest `required` arrays from schemas.js reach the wire.
 */
function normalizeTools(tools, { strictRequired = true } = {}) {
  if (!tools || tools.length === 0) return undefined;

  return tools.map(tool => {
    const params = JSON.parse(JSON.stringify(tool.parameters || {}));
    stripEmptyRequired(params);
    condenseSchema(params);
    flattenDeepNesting(params);
    if (strictRequired) makeAllRequired(params);
    return {
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description || '',
        parameters: params
      }
    };
  });
}

/**
 * Stream LLM response with tool support
 * @param {Array} messages - Conversation messages
 * @param {Array} tools - Tool definitions
 * @param {Object} config - Optional config override
 * @returns {AsyncGenerator} Yields chunks with type, content, toolCalls
 */
/**
 * Normalize multimodal user message content for a specific LLM provider.
 * Input: string or array of { type: 'text'|'image'|'document_text', ... }
 * Output: provider-specific content format.
 */
function normalizeUserContent(content, provider) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return content;

  const textParts = content.filter(b => b.type === 'text' || b.type === 'document_text');
  const imageParts = content.filter(b => b.type === 'image');

  // Combine text + document text into a single string
  const combinedText = textParts.map(b => {
    if (b.type === 'document_text') return `[File: ${b.filename}]\n${b.text}`;
    return b.text;
  }).join('\n\n');

  if (imageParts.length === 0) {
    return combinedText || '';
  }

  if (provider === 'anthropic') {
    const blocks = [];
    if (combinedText) blocks.push({ type: 'text', text: combinedText });
    for (const img of imageParts) {
      blocks.push({
        type: 'image',
        source: { type: 'base64', media_type: img.media_type, data: img.data }
      });
    }
    return blocks;
  }

  if (provider === 'openai' || provider === 'openrouter' || provider === 'local') {
    const blocks = [];
    if (combinedText) blocks.push({ type: 'text', text: combinedText });
    for (const img of imageParts) {
      blocks.push({
        type: 'image_url',
        image_url: { url: `data:${img.media_type};base64,${img.data}` }
      });
    }
    return blocks;
  }

  if (provider === 'google') {
    // Gemini uses a different structure handled in streamGemini,
    // but we normalize to a common format it can consume
    const blocks = [];
    if (combinedText) blocks.push({ type: 'text', text: combinedText });
    for (const img of imageParts) {
      blocks.push({ type: 'image', media_type: img.media_type, data: img.data });
    }
    return blocks;
  }

  // Unknown provider: degrade to text only
  return combinedText || '';
}

export async function* streamLLM(messages, tools = [], config = {}, signal = null) {
  const defaults = getDefaultConfig();
  const provider = config.provider || defaults.provider;
  const endpoint = config.endpoint || defaults.endpoint;
  const model = config.model || defaults.model;
  const apiKey = config.apiKey || '';
  const maxTokens = config.maxTokens ?? defaults.maxTokens;

  // Local/small models (LM Studio, Ollama, llama.cpp, etc.) need honest schemas and
  // a low temperature for reliable native tool-calling.
  const isLocal = provider === 'local' || /localhost|127\.0\.0\.1/.test(endpoint || '');

  // Temperature: 0.7 for cloud, 0.1 for local/small. The wizard profile always sends
  // 0.7 (AISection hardcodes it — there is no temperature control in the AI settings UI),
  // and THIS request parameter OVERRIDES LM Studio's own UI setting, so this is the only
  // place the low-temperature fix can take effect. We treat the app-wide 0.7 default (or an
  // unset value) as "not user-chosen" for local and drop it to 0.1; a genuinely different
  // configured value is respected.
  const temperature = isLocal
    ? ((config.temperature == null || config.temperature === defaults.temperature) ? 0.1 : config.temperature)
    : (config.temperature ?? defaults.temperature);

  console.error('🔵 streamLLM called with provider:', provider, 'model:', model, 'tools:', tools.length, 'temp:', temperature, 'isLocal:', isLocal);

  const normalizedTools = normalizeTools(tools, { strictRequired: !isLocal });

  // Normalize multimodal content blocks for the target provider
  const normalizedMessages = messages.map(msg => {
    if (msg.role === 'user' && Array.isArray(msg.content)) {
      return { ...msg, content: normalizeUserContent(msg.content, provider) };
    }
    return msg;
  });

  if (provider === 'openrouter') {
    yield* streamOpenRouter(normalizedMessages, normalizedTools, { endpoint, model, apiKey, temperature, maxTokens }, signal);
  } else if (provider === 'anthropic') {
    yield* streamAnthropic(normalizedMessages, normalizedTools, { endpoint, model, apiKey, temperature, maxTokens }, signal);
  } else if (provider === 'openai' || provider === 'local') {
    yield* streamOpenAI(normalizedMessages, normalizedTools, { endpoint, model, apiKey, temperature, maxTokens }, signal);
  } else if (provider === 'google') {
    yield* streamGemini(normalizedMessages, normalizedTools, { model, apiKey, temperature, maxTokens }, signal);
  } else {
    throw new Error(`Unsupported provider: ${provider}`);
  }
}

/**
 * Drop the loop's internal bookkeeping fields before a message reaches a
 * provider. Anything prefixed with `_` (the volatile-context marker, dedup keys,
 * tool names carried alongside tool results) is ours, not the API's — OpenAI-style
 * endpoints pass messages through verbatim and reject unknown properties.
 *
 * The Anthropic path does its own stripping because it rebuilds messages wholesale.
 */
export function stripInternalFields(messages) {
  return (messages || []).map(msg => {
    const out = {};
    for (const key of Object.keys(msg)) {
      if (!key.startsWith('_')) out[key] = msg[key];
    }
    return out;
  });
}

/**
 * Models that need EXPLICIT cache breakpoints when reached through OpenRouter.
 *
 * OpenRouter caches automatically for OpenAI, Grok, Groq, DeepSeek and Gemini
 * 2.5 — but NOT for Anthropic, which requires the same `cache_control` markers
 * the native API does. Since the default model here is an Anthropic one
 * (`anthropic/claude-3.5-sonnet`), "OpenRouter handles caching for us" was
 * exactly wrong for the configured default, and every request paid full price
 * for a ~28k-token prefix that never changed.
 */
function needsExplicitCacheBreakpoints(model) {
  return /anthropic|claude/i.test(String(model || ''));
}

/**
 * Mark the system message so its content — and, by prefix, the tool schemas
 * ahead of it — is cached.
 *
 * `cache_control` cannot be attached to the `tools` array itself. It does not
 * need to be: caching covers the request PREFIX in the order tools → system →
 * messages, so a breakpoint on the system block already includes every tool
 * definition before it. That one marker is what recovers the whole fixed floor.
 *
 * A 1-hour TTL rather than the 5-minute default: agent iterations can be minutes
 * apart when a slow tool or a user prompt sits between them, and an expired entry
 * costs 1.25x to rebuild.
 */
function withOpenRouterCaching(messages, model) {
  const stripped = stripInternalFields(messages);
  if (!needsExplicitCacheBreakpoints(model)) return stripped;

  return stripped.map((msg, i) => {
    if (msg.role !== 'system' || typeof msg.content !== 'string' || !msg.content) return msg;
    // Only the leading system message is stable enough to be worth an entry.
    if (i !== 0) return msg;
    return {
      ...msg,
      content: [{
        type: 'text',
        text: msg.content,
        cache_control: { type: 'ephemeral', ttl: '1h' }
      }]
    };
  });
}

/**
 * Stream from OpenRouter API
 */
async function* streamOpenRouter(messages, tools, { endpoint, model, apiKey, temperature, maxTokens }, signal = null) {
  const payload = {
    model,
    messages: withOpenRouterCaching(messages, model),
    ...(tools && tools.length > 0 ? { tools, tool_choice: 'auto' } : {}),
    max_tokens: maxTokens,
    temperature,
    stream: true,
    // Ask for token usage in the stream's final chunk (choices: []) for accounting.
    stream_options: { include_usage: true }
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
        // Awaited and caught: a floating cancel() on a body that already errored
        // becomes an unhandled rejection, which in Electron surfaces as a crash
        // dialog for something entirely recoverable.
        await reader.cancel().catch(() => { });
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

            // Token accounting — the include_usage final chunk carries usage with
            // choices: [], so read it before the `!choice` guard would skip it.
            const orUsage = normalizeOpenAIUsage(chunk.usage);
            if (orUsage) yield { type: 'usage', usage: orUsage };

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
                        parsedArgs = deepParseJsonStrings(JSON.parse(currentToolCall.function?.arguments || '{}'));
                      } catch (e) {
                        console.warn('[LLMClient:OpenRouter] Failed to parse transition tool args:', e);
                        parsedArgs = { error: 'The spell was cut short! (Response truncated)' };
                      }

                      yield {
                        type: 'tool_call',
                        name: tcName,
                        args: stripNulls(parsedArgs),
                        id: currentToolCall.id
                      };
                    }
                  }
                  // New tool detected - initialize with hasYieldedStart flag
                  currentToolCall = {
                    index,
                    id: toolCall.id,
                    function: { name: '', arguments: '' },
                    hasYieldedStart: false  // Track if we've emitted tool_call_start
                  };
                }

                // Update name if present
                if (toolCall.function?.name) {
                  currentToolCall.function.name = toolCall.function.name;
                }

                // Only yield tool_call_start ONCE when we first get a valid name
                if (currentToolCall.function.name && !currentToolCall.hasYieldedStart) {
                  yield {
                    type: 'tool_call_start',
                    id: currentToolCall.id,
                    name: currentToolCall.function.name
                  };
                  currentToolCall.hasYieldedStart = true;
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
                  parsedArgs = deepParseJsonStrings(JSON.parse(currentToolCall.function?.arguments || '{}'));
                } catch (e) {
                  console.warn('[LLMClient:OpenRouter] Failed to parse finished tool args:', e);
                  parsedArgs = { error: 'The spell was cut short! (Response truncated)' };
                }

                yield {
                  type: 'tool_call',
                  name: tcName,
                  args: stripNulls(parsedArgs),
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
          parsedArgs = deepParseJsonStrings(JSON.parse(currentToolCall.function?.arguments || '{}'));
        } catch (e) {
          console.warn('[LLMClient:OpenRouter] Failed to parse flushed tool args (likely truncated):', e);
          parsedArgs = { error: 'The spell was cut short! (Response truncated)' };
        }

        yield {
          type: 'tool_call',
          name: tcName,
          args: stripNulls(parsedArgs),
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
 * How far back the older of the two rolling history breakpoints sits, measured in
 * cacheable (non-volatile) messages. One assistant turn plus its tool results is
 * typically 2-3 messages, so four covers roughly the last iteration and a half —
 * far enough that the previous request's entry is still readable, near enough
 * that the uncached remainder stays small.
 */
const HISTORY_CACHE_LOOKBACK = 4;

/**
 * Place the two rolling message breakpoints.
 *
 * Anchors go on the last content block of the chosen messages. The volatile tail
 * — and anything after it — is deliberately excluded: it changes every request,
 * so an entry anchored there could only ever be written, never read.
 *
 * Exported for tests; the placement is the whole mechanism and worth asserting on.
 */
export function applyHistoryCacheBreakpoints(messages, lookback = HISTORY_CACHE_LOOKBACK) {
  const out = messages.map(m => ({ ...m }));
  // Cacheable region = everything up to the first volatile message.
  let cacheableEnd = out.length;
  for (let i = 0; i < out.length; i++) {
    if (out[i]._volatile) { cacheableEnd = i; break; }
  }
  // Fewer than two cacheable turns and there is no history worth an entry — the
  // tools and system breakpoints already cover the whole stable prefix.
  if (cacheableEnd < 2) return out.map(stripCacheMeta);

  const newest = cacheableEnd - 1;
  const older = Math.max(0, newest - lookback);
  // The older anchor exists to keep the PREVIOUS request's entry readable. When
  // the two would land almost on top of each other there is no earlier entry to
  // preserve, and spending a second breakpoint on a near-identical prefix just
  // buys another cache write. One is enough.
  const anchors = newest - older >= 2 ? [older, newest] : [newest];

  for (const idx of anchors) {
    const msg = out[idx];
    const blocks = Array.isArray(msg.content)
      ? msg.content.map(b => ({ ...b }))
      : [{ type: 'text', text: String(msg.content ?? '') }];
    if (blocks.length === 0) continue;
    blocks[blocks.length - 1] = {
      ...blocks[blocks.length - 1],
      cache_control: { type: 'ephemeral' }
    };
    msg.content = blocks;
  }

  return out.map(stripCacheMeta);
}

/** Drop internal bookkeeping fields the API would reject. */
function stripCacheMeta(msg) {
  const { _volatile, ...rest } = msg;
  return rest;
}

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
      // User message. The volatile-context flag rides along so the breakpoint
      // logic below can avoid anchoring a cache entry to the one message that is
      // guaranteed to differ on the next request.
      conversationMessages.push({
        role: 'user',
        content: msg.content,
        ...(isVolatileContextMessage(msg) ? { _volatile: true } : {})
      });
    }
  }

  // Merge adjacent same-role turns. A tool-result turn is emitted as a `user`
  // message, so a trailing context block lands as a second consecutive `user`
  // message; Anthropic tolerates that but the merged form is what its cache
  // examples assume, and merging keeps the breakpoint indices below meaning what
  // they look like they mean.
  const mergedMessages = [];
  for (const msg of conversationMessages) {
    const prev = mergedMessages[mergedMessages.length - 1];
    if (prev && prev.role === msg.role) {
      const asBlocks = (c) => (Array.isArray(c) ? c : [{ type: 'text', text: String(c ?? '') }]);
      prev.content = [...asBlocks(prev.content), ...asBlocks(msg.content)];
      if (msg._volatile) prev._volatile = true;
      continue;
    }
    mergedMessages.push({ ...msg });
  }

  // Prompt caching. Anthropic caches the request PREFIX up to each cache_control
  // breakpoint, in the fixed order tools → system → messages, and allows four
  // breakpoints. All four are used here, because caching only the front of the
  // request leaves the part that actually grows — the conversation — paying full
  // price on every iteration of an agentic run.
  //
  //   1. tools    — frozen for the whole ask (AgentLoop no longer re-selects
  //                 per iteration; doing so invalidated everything downstream)
  //   2. system   — fully static; the graph snapshot moved to the request tail
  //   3/4. messages — two ROLLING breakpoints. The older one keeps the previous
  //                 iteration's prefix warm while the newer one extends the entry
  //                 to cover what was just added. With a single moving breakpoint
  //                 each iteration would miss the entry it wrote a moment ago.
  //
  // Nothing is anchored to the volatile tail block: it differs by construction on
  // the next request, so a breakpoint there would write an entry that can never
  // be read — at 1.25x, strictly worse than not caching it.
  const cachePrefix = systemMessage?._cachePrefix;
  const systemContent = systemMessage?.content || '';
  let systemField;
  if (cachePrefix && systemContent.startsWith(cachePrefix)) {
    const volatilePart = systemContent.slice(cachePrefix.length);
    systemField = [
      { type: 'text', text: cachePrefix, cache_control: { type: 'ephemeral' } },
      ...(volatilePart ? [{ type: 'text', text: volatilePart }] : [])
    ];
  } else {
    systemField = systemContent;
  }

  // A breakpoint on the LAST tool caches the entire tools block before it.
  let cachedTools = tools;
  if (Array.isArray(tools) && tools.length > 0) {
    cachedTools = tools.map((t, i) =>
      i === tools.length - 1 ? { ...t, cache_control: { type: 'ephemeral' } } : t
    );
  }

  const finalMessages = applyHistoryCacheBreakpoints(mergedMessages);

  const payload = {
    model: model || 'claude-3-5-sonnet-20241022',
    max_tokens: maxTokens || 8192,
    system: systemField,
    messages: finalMessages,
    ...(cachedTools && cachedTools.length > 0 ? { tools: cachedTools } : {}),
    temperature: temperature ?? 0.7,
    stream: true
  };

  const response = await fetch(endpoint || 'https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      // Required when this runs in the browser (the agent loop is in-app now).
      // Redstring is BYOK: the key is the user's own and already lives in their
      // browser, so this header withholds no protection it previously had.
      'anthropic-dangerous-direct-browser-access': 'true'
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
  // Token accounting: Anthropic reports input_tokens on message_start and a
  // cumulative output_tokens on each message_delta. Hold the input so we can
  // emit a complete usage event when the deltas land.
  //
  // input_tokens counts ONLY the uncached portion. Cached tokens arrive in their
  // own fields and are billed differently (writes 1.25x, reads 0.1x), so they
  // have to be carried separately rather than folded in — the whole point of the
  // budget rework is that a cache read is not the same expense as a fresh upload.
  let anthropicInputTokens = 0;
  let anthropicCacheReadTokens = 0;
  let anthropicCacheCreationTokens = 0;

  try {
    while (true) {
      if (signal?.aborted) {
        // Awaited and caught: a floating cancel() on a body that already errored
        // becomes an unhandled rejection, which in Electron surfaces as a crash
        // dialog for something entirely recoverable.
        await reader.cancel().catch(() => { });
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

            // Token accounting. input_tokens arrive on message_start; a cumulative
            // output_tokens arrives on each message_delta — emit the running total.
            if (chunk.type === 'message_start' && chunk.message?.usage) {
              anthropicInputTokens = chunk.message.usage.input_tokens || 0;
              anthropicCacheReadTokens = chunk.message.usage.cache_read_input_tokens || 0;
              anthropicCacheCreationTokens = chunk.message.usage.cache_creation_input_tokens || 0;
            }
            if (chunk.type === 'message_delta' && chunk.usage) {
              const completionTokens = chunk.usage.output_tokens || 0;
              // promptTokens is the FULL input the model read, cached or not, so
              // context-window math stays honest; the cache split rides alongside
              // it for the cost calculation.
              const promptTokens =
                anthropicInputTokens + anthropicCacheReadTokens + anthropicCacheCreationTokens;
              yield {
                type: 'usage',
                usage: {
                  promptTokens,
                  completionTokens,
                  totalTokens: promptTokens + completionTokens,
                  uncachedPromptTokens: anthropicInputTokens,
                  cacheReadTokens: anthropicCacheReadTokens,
                  cacheCreationTokens: anthropicCacheCreationTokens
                }
              };
            }

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
                  parsedArgs = deepParseJsonStrings(JSON.parse(toolArgsBuffer || '{}'));
                } catch (e) {
                  console.warn('[LLMClient:Anthropic] Partial/invalid JSON for tool args:', toolArgsBuffer);
                  parsedArgs = { error: 'Truncated tool arguments' };
                }
                yield {
                  type: 'tool_call',
                  name: tcName,
                  args: stripNulls(parsedArgs),
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
          parsedArgs = deepParseJsonStrings(JSON.parse(toolArgsBuffer || '{}'));
        } catch (e) {
          console.warn('[LLMClient:Anthropic] Partial/invalid JSON for flushed tool args:', toolArgsBuffer);
          parsedArgs = { error: 'Truncated tool arguments' };
        }
        yield {
          type: 'tool_call',
          name: tcName,
          args: stripNulls(parsedArgs),
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
    messages: stripInternalFields(messages),
    ...(tools && tools.length > 0 ? { tools, tool_choice: 'auto' } : {}),
    max_tokens: maxTokens,
    temperature,
    stream: true,
    // Request token usage in the final stream chunk. Servers that don't support
    // it (some local backends) simply ignore the field.
    stream_options: { include_usage: true }
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
  // State for parsing <think>...</think> tags embedded in delta.content
  let thinkTagBuffer = '';
  let inThinkTag = false;

  try {
    while (true) {
      if (signal?.aborted) {
        // Awaited and caught: a floating cancel() on a body that already errored
        // becomes an unhandled rejection, which in Electron surfaces as a crash
        // dialog for something entirely recoverable.
        await reader.cancel().catch(() => { });
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

            // Token accounting — include_usage final chunk has choices: [].
            const oaUsage = normalizeOpenAIUsage(chunk.usage);
            if (oaUsage) yield { type: 'usage', usage: oaUsage };

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
                        parsedArgs = deepParseJsonStrings(JSON.parse(currentToolCall.function?.arguments || '{}'));
                      } catch (e) {
                        console.warn('[LLMClient:OpenAI] Failed to parse transition tool args:', e);
                        parsedArgs = { error: 'The spell was cut short! (Response truncated)' };
                      }

                      yield {
                        type: 'tool_call',
                        name: tcName,
                        args: stripNulls(parsedArgs),
                        id: currentToolCall.id
                      };
                    }
                  }
                  // New tool detected - initialize with hasYieldedStart flag
                  currentToolCall = {
                    index,
                    id: toolCall.id,
                    function: { name: '', arguments: '' },
                    hasYieldedStart: false  // Track if we've emitted tool_call_start
                  };
                }

                // Update name if present
                if (toolCall.function?.name) {
                  currentToolCall.function.name = toolCall.function.name;
                }

                // Only yield tool_call_start ONCE when we first get a valid name
                if (currentToolCall.function.name && !currentToolCall.hasYieldedStart) {
                  yield {
                    type: 'tool_call_start',
                    id: currentToolCall.id,
                    name: currentToolCall.function.name
                  };
                  currentToolCall.hasYieldedStart = true;
                }

                if (toolCall.function?.arguments) {
                  currentToolCall.function.arguments += toolCall.function.arguments;
                }
                if (toolCall.id) {
                  currentToolCall.id = toolCall.id;
                }
              }
            }

            // Thinking content — four formats depending on provider/model:
            // 1. delta.thinking_content (Ollama native thinking field)
            // 2. delta.reasoning_content (DeepSeek API)
            // 3. delta.reasoning (Gemma 4 via Ollama)
            // 4. <think>...</think> tags embedded in delta.content (common fallback)
            if (delta?.thinking_content) {
              yield { type: 'thinking', content: delta.thinking_content };
            } else if (delta?.reasoning_content) {
              yield { type: 'thinking', content: delta.reasoning_content };
            } else if (delta?.reasoning) {
              yield { type: 'thinking', content: delta.reasoning };
            }

            // Text content — parse out any embedded <think>...</think> blocks
            if (delta?.content) {
              thinkTagBuffer += delta.content;
              // Process buffer, splitting on <think>/<\/think> boundaries
              while (thinkTagBuffer.length > 0) {
                if (inThinkTag) {
                  const closeIdx = thinkTagBuffer.indexOf('</think>');
                  if (closeIdx >= 0) {
                    if (closeIdx > 0) yield { type: 'thinking', content: thinkTagBuffer.slice(0, closeIdx) };
                    thinkTagBuffer = thinkTagBuffer.slice(closeIdx + 8);
                    inThinkTag = false;
                  } else {
                    // Keep last 8 chars in buffer (partial </think> might span chunks)
                    const safe = Math.max(0, thinkTagBuffer.length - 8);
                    if (safe > 0) { yield { type: 'thinking', content: thinkTagBuffer.slice(0, safe) }; thinkTagBuffer = thinkTagBuffer.slice(safe); }
                    break;
                  }
                } else {
                  const openIdx = thinkTagBuffer.indexOf('<think>');
                  if (openIdx >= 0) {
                    if (openIdx > 0) yield { type: 'text', content: thinkTagBuffer.slice(0, openIdx) };
                    thinkTagBuffer = thinkTagBuffer.slice(openIdx + 7);
                    inThinkTag = true;
                  } else {
                    // Keep last 7 chars in buffer (partial <think> might span chunks)
                    const safe = Math.max(0, thinkTagBuffer.length - 7);
                    if (safe > 0) { yield { type: 'text', content: thinkTagBuffer.slice(0, safe) }; thinkTagBuffer = thinkTagBuffer.slice(safe); }
                    break;
                  }
                }
              }
            }

            // Finish tool call if done
            if (choice.finish_reason === 'tool_calls' && currentToolCall) {
              const tcName = currentToolCall.function?.name;
              if (!tcName) {
                console.error('[LLMClient:OpenAI] Skipping tool_call with empty name at finish');
              } else {
                let parsedArgs = {};
                try {
                  parsedArgs = deepParseJsonStrings(JSON.parse(currentToolCall.function?.arguments || '{}'));
                } catch (e) {
                  console.warn('[LLMClient:OpenAI] Failed to parse finished tool args:', e);
                  parsedArgs = { error: 'The spell was cut short! (Response truncated)' };
                }

                yield {
                  type: 'tool_call',
                  name: tcName,
                  args: stripNulls(parsedArgs),
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

    // Flush any remaining think tag buffer content
    if (thinkTagBuffer.length > 0) {
      yield { type: inThinkTag ? 'thinking' : 'text', content: thinkTagBuffer };
    }

    // Flush remaining tool call
    if (currentToolCall) {
      const tcName = currentToolCall.function?.name;
      if (!tcName) {
        console.error('[LLMClient:OpenAI] Skipping tool_call with empty name at flush');
      } else {
        let parsedArgs = {};
        try {
          parsedArgs = deepParseJsonStrings(JSON.parse(currentToolCall.function?.arguments || '{}'));
        } catch (e) {
          console.warn('[LLMClient:OpenAI] Failed to parse flushed tool args:', e);
          parsedArgs = { error: 'The spell was cut short! (Response truncated)' };
        }

        yield {
          type: 'tool_call',
          name: tcName,
          args: stripNulls(parsedArgs),
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
  console.log('🔴🔴🔴 GEMINI STREAM STARTED 🔴🔴🔴');
  console.error('🔴🔴🔴 GEMINI STREAM STARTED 🔴🔴🔴');

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
          // Thinking models (Gemini 2.5+) require thoughtSignature to round-trip
          // on the Part wrapping the functionCall (not inside functionCall itself).
          // Non-thinking models omit it, so this is a no-op there.
          const part = { functionCall: { name: fnName, args: fnArgs } };
          if (tc.thoughtSignature) part.thoughtSignature = tc.thoughtSignature;
          parts.push(part);
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
      // User message (plain string or array with text/image blocks)
      if (Array.isArray(msg.content)) {
        const parts = [];
        for (const item of msg.content) {
          if (item.type === 'text') {
            parts.push({ text: item.text || '' });
          } else if (item.type === 'image' && item.data) {
            parts.push({ inlineData: { mimeType: item.media_type || 'image/png', data: item.data } });
          }
        }
        if (parts.length > 0) contents.push({ role: 'user', parts });
      } else {
        contents.push({ role: 'user', parts: [{ text: msg.content || '' }] });
      }
    }
  }

  // Convert tool definitions to Gemini functionDeclarations format
  // Schemas are already fully prepared by normalizeTools() — just reformat
  let geminiTools = undefined;
  if (tools && tools.length > 0) {
    geminiTools = [{
      functionDeclarations: tools.map(t => ({
        name: t.function?.name || t.name,
        description: t.function?.description || t.description || '',
        parameters: t.function?.parameters || t.parameters || { type: 'object', properties: {} }
      }))
    }];
    console.error('[LLMClient:Gemini] Sending', geminiTools[0].functionDeclarations.length, 'tools to Gemini:', geminiTools[0].functionDeclarations.map(t => t.name).join(', '));
  }

  // Determine function calling mode:
  // - Use 'ANY' if no tool results yet (force initial tool use)
  // - Use 'AUTO' after tools have been called (allow natural responses)
  const hasToolResults = messages.some(m => m.role === 'tool');
  const functionCallingMode = hasToolResults ? 'AUTO' : 'ANY';
  console.error('[LLMClient:Gemini] Function calling mode:', functionCallingMode, '(hasToolResults:', hasToolResults, ')');

  const effectiveModel = model || 'gemini-2.5-flash';
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${effectiveModel}:streamGenerateContent?alt=sse&key=${apiKey}`;

  const payload = {
    contents,
    ...(systemParts.length > 0 ? { systemInstruction: { parts: systemParts } } : {}),
    ...(geminiTools ? { tools: geminiTools } : {}),
    ...(geminiTools ? { toolConfig: { functionCallingConfig: { mode: functionCallingMode } } } : {}),
    generationConfig: {
      temperature: temperature ?? 0.7,
      maxOutputTokens: maxTokens ?? 8192
    }
  };

  // Audit outgoing functionCall parts for thoughtSignature presence — if any are
  // missing, the next turn will fail with INVALID_ARGUMENT on thinking models.
  {
    const summary = contents.map((c, i) => {
      if (c.role !== 'model' || !Array.isArray(c.parts)) return null;
      const fnParts = c.parts.filter(p => p.functionCall);
      if (fnParts.length === 0) return null;
      const status = fnParts.map(p => `${p.functionCall.name}${p.thoughtSignature ? '✓sig' : '✗no-sig'}`).join(',');
      return `[${i}] ${status}`;
    }).filter(Boolean);
    if (summary.length > 0) {
      console.error('[LLMClient:Gemini] Outgoing functionCall sig audit:', summary.join(' | '));
    }
  }

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
  // Thinking models (Gemini 2.5+) often emit thoughtSignature on a thought-only Part
  // (no text/functionCall) that PRECEDES the functionCall Part. We accumulate any
  // signature we see and attach it to the next emitted functionCall.
  let pendingThoughtSignature = null;

  try {
    while (true) {
      if (signal?.aborted) {
        // Awaited and caught: a floating cancel() on a body that already errored
        // becomes an unhandled rejection, which in Electron surfaces as a crash
        // dialog for something entirely recoverable.
        await reader.cancel().catch(() => { });
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

          // Token accounting. Gemini streams usageMetadata (cumulative for this
          // call) as a top-level sibling of `candidates`, typically on the final
          // chunk — read it BEFORE the `!candidate` guard so a usage-only tail
          // chunk is never skipped. The consumer takes the last usage per call.
          if (chunk.usageMetadata) {
            const u = chunk.usageMetadata;
            const promptTokens = u.promptTokenCount || 0;
            const totalTokens = u.totalTokenCount || 0;
            // Gemini 2.5 thinking models bill thoughts as output; totalTokenCount
            // already includes them, so derive completion from total when present.
            const completionTokens = totalTokens
              ? Math.max(0, totalTokens - promptTokens)
              : ((u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0));
            // Cached input. Gemini 2.5 caches implicitly — no request-side markers,
            // but it only hits when the leading part of the request is byte-stable,
            // which is why the tool set is frozen per ask, the system instruction is
            // static, and the volatile graph snapshot rides at the tail.
            //
            // Not reading this field meant `promptTokenCount` was charged in full
            // every iteration even when Google had already discounted most of it —
            // the budget saw ~35k/iteration for input the model was billing a
            // fraction of, and tripped a cost ceiling that had not been reached.
            const cacheReadTokens = u.cachedContentTokenCount || 0;
            yield {
              type: 'usage',
              usage: {
                promptTokens,
                completionTokens,
                totalTokens,
                uncachedPromptTokens: Math.max(0, promptTokens - cacheReadTokens),
                cacheReadTokens,
                // Implicit caching is populated by Google, never billed as a write.
                cacheCreationTokens: 0
              }
            };
          }

          const candidate = chunk.candidates?.[0];
          if (!candidate) continue;

          const parts = candidate.content?.parts || [];
          if (parts.length > 0) {
            const partTypes = parts.map(p => {
              const kind = p.text ? 'text' : p.functionCall ? 'functionCall' : p.thought ? 'thought' : 'other';
              return p.thoughtSignature ? `${kind}+sig` : kind;
            }).join(', ');
            console.error('[LLMClient:Gemini] Chunk parts:', partTypes);
            // Dump raw structure of any chunk that mentions thinking — helps verify the
            // shape Gemini actually sends so we know we're capturing signatures correctly.
            if (parts.some(p => p.thoughtSignature || p.thought || p.functionCall)) {
              console.error('[LLMClient:Gemini] Raw chunk (relevant):', JSON.stringify(chunk).slice(0, 2000));
            }
          }
          for (const part of parts) {
            // Capture any thoughtSignature on this part (thought-only Parts often carry it
            // ahead of the functionCall they relate to). Last-seen wins until consumed.
            if (part.thoughtSignature) {
              pendingThoughtSignature = part.thoughtSignature;
              console.error('[LLMClient:Gemini] ✓ Buffered thoughtSignature (len=' + part.thoughtSignature.length + ')');
            }
            if (part.text) {
              yield { type: 'text', content: part.text };
            } else if (part.functionCall) {
              console.error('[LLMClient:Gemini] Received functionCall:', part.functionCall.name, 'with args keys:', Object.keys(part.functionCall.args || {}));
              // Validate function call name
              const fnName = part.functionCall.name;
              if (!fnName || typeof fnName !== 'string' || fnName.trim() === '') {
                console.error('[LLMClient:Gemini] ❌ SKIPPED functionCall with missing/empty name:', JSON.stringify(part.functionCall));
                continue;
              }
              console.error('[LLMClient:Gemini] ✓ Validated functionCall:', fnName);

              const fnArgs = stripNulls(deepParseJsonStrings(part.functionCall.args || {}));
              if (!fnArgs || (typeof fnArgs === 'object' && Object.keys(fnArgs).length === 0)) {
                console.error('[LLMClient:Gemini] Warning: functionCall "' + fnName + '" received with empty args');
              }
              // Prefer signature on the same Part as the functionCall; fall back to any
              // pending signature from a preceding thought-only Part in this stream.
              const thoughtSignature = part.thoughtSignature || pendingThoughtSignature;
              if (thoughtSignature) {
                console.error('[LLMClient:Gemini] ✓ Attached thoughtSignature to functionCall:', fnName, '(source:', part.thoughtSignature ? 'inline' : 'pending', ')');
                pendingThoughtSignature = null;
              } else {
                console.error('[LLMClient:Gemini] ⚠️ No thoughtSignature available for functionCall:', fnName, '— Gemini will reject the next turn');
              }

              // Flush any pending function call before starting a new one
              if (pendingFunctionCall) {
                yield {
                  type: 'tool_call',
                  name: pendingFunctionCall.name,
                  args: pendingFunctionCall.args,
                  id: pendingFunctionCall.id,
                  ...(pendingFunctionCall.thoughtSignature ? { thoughtSignature: pendingFunctionCall.thoughtSignature } : {})
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
                // Event loop break happens in wizard-server.js after tool_call_start
                console.error('[LLMClient:Gemini] → Yielding tool_call:', fnName, 'with', Object.keys(fnArgs || {}).length, 'arg keys');
                yield {
                  type: 'tool_call',
                  name: fnName,
                  args: fnArgs || {},
                  id: fnId,
                  ...(thoughtSignature ? { thoughtSignature } : {})
                };
              } else {
                // Args not yet available — hold for flush
                pendingFunctionCall = { id: fnId, name: fnName, args: {}, thoughtSignature };
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
        id: pendingFunctionCall.id,
        ...(pendingFunctionCall.thoughtSignature ? { thoughtSignature: pendingFunctionCall.thoughtSignature } : {})
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

// Exported for testing
export { makeAllRequired as _makeAllRequired, flattenDeepNesting as _flattenDeepNesting, stripNulls as _stripNulls, deepParseJsonStrings as _deepParseJsonStrings, condenseSchema as _condenseSchema, stripEmptyRequired as _stripEmptyRequired, normalizeTools as _normalizeTools };

