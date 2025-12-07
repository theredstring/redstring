/**
 * LLM Caller - Reusable function for calling LLM APIs
 * Supports OpenRouter and Anthropic APIs
 */

/**
 * Call an LLM with a prompt
 * @param {Object} options
 * @param {string} options.apiKey - API key
 * @param {string} options.provider - 'openrouter' | 'anthropic'
 * @param {string} options.endpoint - API endpoint URL
 * @param {string} options.model - Model identifier
 * @param {string} options.systemPrompt - System prompt
 * @param {string} options.userPrompt - User prompt
 * @param {Array} options.messages - Conversation history (optional)
 * @param {number} options.maxTokens - Max tokens
 * @param {number} options.temperature - Temperature
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
  maxTokens = 2000,
  temperature = 0.7
}) {
  if (!apiKey) {
    throw new Error('API key is required');
  }

  if (provider === 'openrouter') {
    const openRouterEndpoint = endpoint || 'https://openrouter.ai/api/v1/chat/completions';
    const openRouterModel = model || 'anthropic/claude-3.5-sonnet';

    const payload = {
      model: openRouterModel,
      messages: [
        ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
        ...messages,
        { role: 'user', content: userPrompt }
      ],
      max_tokens: maxTokens,
      temperature
    };

    const response = await fetch(openRouterEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenRouter API error (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || '';
  } else if (provider === 'anthropic') {
    const anthropicEndpoint = endpoint || 'https://api.anthropic.com/v1/messages';
    const anthropicModel = model || 'claude-3-5-sonnet-20241022';

    const payload = {
      model: anthropicModel,
      max_tokens: maxTokens,
      system: systemPrompt || '',
      messages: [
        ...messages,
        { role: 'user', content: userPrompt }
      ],
      temperature
    };

    const response = await fetch(anthropicEndpoint, {
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

    const data = await response.json();
    return data.content?.[0]?.text || '';
  } else {
    throw new Error(`Unsupported provider: ${provider}`);
  }
}



