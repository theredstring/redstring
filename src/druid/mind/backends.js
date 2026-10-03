/**
 * Mind backends: where a call actually goes.
 *
 *   openaiCompatible  any /v1/chat/completions server (LM Studio, Ollama, llama.cpp),
 *                     with the answer shape enforced by response_format json_schema
 *   scripted          a function, for tests and the lab's dry runs
 *   (afm)             Apple's on-device model, via native/afm-bridge — see afmBackend.js
 */

/**
 * @param {Object} opts
 * @param {string} opts.endpoint   full chat-completions URL
 * @param {string} opts.model
 * @param {string} [opts.apiKey]
 * @param {Function} [opts.fetchImpl]
 */
export function openaiCompatible({ endpoint, model, apiKey = 'local', fetchImpl = globalThis.fetch, timeoutMs = 120000 }) {
  return {
    id: `openai:${model}`,
    async complete({ system, user, schema, maxTokens, temperature }) {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), timeoutMs);
      try {
        const res = await fetchImpl(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
          signal: ac.signal,
          body: JSON.stringify({
            model,
            temperature,
            max_tokens: maxTokens,
            stream: false,
            messages: [
              ...(system ? [{ role: 'system', content: system }] : []),
              { role: 'user', content: user }
            ],
            ...(schema ? { response_format: { type: 'json_schema', json_schema: { name: schema.name, strict: true, schema: schema.schema } } } : {})
          })
        });
        if (!res.ok) throw new Error(`model server ${res.status}: ${(await res.text()).slice(0, 200)}`);
        const data = await res.json();
        return {
          content: data?.choices?.[0]?.message?.content ?? '',
          usage: { prompt: data?.usage?.prompt_tokens || 0, completion: data?.usage?.completion_tokens || 0 }
        };
      } finally {
        clearTimeout(timer);
      }
    }
  };
}

/**
 * @param {Function} fn  ({ system, user, schema, maxTokens }) → string | object
 */
export function scripted(fn) {
  return {
    id: 'scripted',
    async complete(req) {
      const out = await fn(req);
      return { content: typeof out === 'string' ? out : JSON.stringify(out), usage: { prompt: 0, completion: 0 } };
    }
  };
}
