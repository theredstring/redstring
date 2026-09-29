/**
 * LLM Caller - one prompt in, the reply text out.
 *
 * A thin wrapper over the Wizard's streamLLM, so every provider (OpenRouter,
 * Anthropic, OpenAI, Gemini, local and custom OpenAI-compatible servers) is
 * spoken to the one way the Wizard speaks to it. This used to be a second,
 * hand-rolled client that drifted: it sent temperature to Claude models that
 * reject it, omitted the header Anthropic needs from a browser, read the reply
 * from content[0] (a thinking block on current Claude models), posted OpenAI
 * keys to localhost when no endpoint was set, and had no Gemini path.
 *
 * Imported (via oneShot.js) by redstring-mcp-server.js: console.error only.
 */

import { streamLLM } from '../../wizard/LLMClient.js';

/**
 * Floor for max_tokens. Current Claude, OpenAI and Gemini models think before
 * answering and the thinking counts against the limit, so a tiny budget (the
 * one-shot classifiers ask for 32) can be spent entirely on thinking and return
 * nothing. Only generated tokens are billed, so the floor costs nothing extra.
 */
const MIN_MAX_TOKENS = 2048;

/**
 * Call an LLM with a prompt
 * @param {Object} options
 * @param {string} options.apiKey - API key (optional for local providers)
 * @param {string} options.provider - 'openrouter' | 'anthropic' | 'openai' | 'google' | 'local' | custom
 * @param {string} options.endpoint - API endpoint URL
 * @param {string} options.model - Model identifier
 * @param {string} options.systemPrompt - System prompt
 * @param {string} options.userPrompt - User prompt
 * @param {Array} options.messages - Conversation history (optional)
 * @param {number} options.maxTokens - Max tokens
 * @param {number} options.temperature - Temperature (ignored where the model rejects it)
 * @returns {Promise<string>} LLM response text
 */
export async function callLLM({
  apiKey,
  provider = 'openrouter',
  endpoint,
  model,
  systemPrompt,
  userPrompt,
  messages = [],
  maxTokens = 8192,
  temperature = 0.7
}) {
  // Local providers may not require API keys
  if (!apiKey && provider !== 'local' && provider !== 'openai') {
    throw new Error('API key is required');
  }

  const conversation = [
    ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
    ...messages,
    { role: 'user', content: userPrompt }
  ];

  let text = '';
  for await (const chunk of streamLLM(conversation, [], {
    apiKey,
    provider,
    endpoint,
    model,
    temperature,
    maxTokens: Math.max(maxTokens || 0, MIN_MAX_TOKENS)
  })) {
    if (chunk.type === 'text') text += chunk.content || '';
  }
  return text;
}
