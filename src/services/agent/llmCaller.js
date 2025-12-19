/**
 * LLM Caller - Reusable function for calling LLM APIs
 * Supports OpenRouter, Anthropic, and local OpenAI-compatible APIs (Ollama, LM Studio, etc.)
 */

/**
 * Call an LLM with a prompt
 * @param {Object} options
 * @param {string} options.apiKey - API key (optional for local providers)
 * @param {string} options.provider - 'openrouter' | 'anthropic' | 'openai' | 'local'
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
  // Local providers may not require API keys
  if (!apiKey && provider !== 'local' && provider !== 'openai') {
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
  } else if (provider === 'openai' || provider === 'local') {
    // OpenAI-compatible endpoint (works with OpenAI, Ollama, LM Studio, LocalAI, vLLM, etc.)
    const openaiEndpoint = endpoint || 'http://localhost:11434/v1/chat/completions';
    const openaiModel = model || 'llama2';
    
    const payload = {
      model: openaiModel,
      messages: [
        ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
        ...messages,
        { role: 'user', content: userPrompt }
      ],
      max_tokens: maxTokens,
      temperature
    };

    // Local LLM servers may not require API keys, but some do
    const headers = {
      'Content-Type': 'application/json',
      ...(apiKey && apiKey !== 'local' && apiKey.trim() !== '' ? { 'Authorization': `Bearer ${apiKey}` } : {})
    };

    const response = await fetch(openaiEndpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });
    
    // Enhanced error handling for local connection issues
    if (!response.ok) {
      const errorText = await response.text();
      if (endpoint?.includes('localhost') || endpoint?.includes('127.0.0.1')) {
        throw new Error(`Local LLM server error: ${errorText}. Is the server running?`);
      }
      throw new Error(`OpenAI API error (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || '';
  } else {
    throw new Error(`Unsupported provider: ${provider}`);
  }
}



