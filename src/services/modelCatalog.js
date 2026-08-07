/**
 * Model Catalog
 *
 * Hand-maintained model lists rot within weeks — a new Gemini Flash or Claude
 * point release ships and the dropdown is already lying. Every provider exposes
 * a models endpoint, so we fetch the real list at runtime and keep the static
 * lists only as an offline/no-key fallback.
 *
 * Per provider we need three things, expressed as an adapter below:
 *   - request:   URL + headers (some take the key in a header, Google in a query param)
 *   - normalize: provider payload -> { id, name, created, tools }
 *   - fallback:  a short static list for when the fetch fails
 *
 * Results are cached in localStorage for a day, keyed by provider + a short
 * fingerprint of the API key so switching accounts doesn't serve a stale list.
 */

const CACHE_KEY = 'redstring_model_catalog_v1';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const SHORTLIST_SIZE = 20;

/** Model families that can't do tool calls, or aren't chat models at all. */
const NON_CHAT_PATTERN = /embed|embedding|tts|whisper|audio|transcribe|realtime|moderation|dall-e|image|imagen|veo|vision-preview|rerank|aqa|guard|codestral-embed/i;

const prettifyId = (id) => id
  .replace(/^[^/]+\//, '')
  .replace(/[-_]/g, ' ')
  .replace(/\b(gpt|api)\b/gi, (m) => m.toUpperCase())
  .replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * Version number embedded in a model id, used as a recency proxy when the
 * provider gives us no timestamp (Google) or a useless one.
 */
const parseVersion = (id) => {
  const match = String(id).match(/(?:gemini|claude|gpt|command|llama|grok|qwen|mistral)[- ]?(\d+(?:[.-]\d+)?)/i);
  if (!match) return -1;
  return parseFloat(match[1].replace('-', '.'));
};

const isPreview = (id) => /preview|experimental|exp|alpha|beta|latest-?snapshot/i.test(id);

const ADAPTERS = {
  // Public and unauthenticated — this one works even before a key is entered.
  openrouter: {
    needsKey: false,
    request: () => ({ url: 'https://openrouter.ai/api/v1/models' }),
    normalize: (data) => (data?.data || []).map((m) => ({
      id: m.id,
      name: m.name || prettifyId(m.id),
      created: (m.created || 0) * 1000,
      // OpenRouter is the only provider that states tool support outright.
      tools: Array.isArray(m.supported_parameters) && m.supported_parameters.includes('tools'),
      context: m.context_length || 0,
      price: parseFloat(m?.pricing?.prompt ?? '0') || 0
    }))
  },

  anthropic: {
    needsKey: true,
    request: (key) => ({
      // `limit` defaults to 20 — without it the list silently truncates.
      url: 'https://api.anthropic.com/v1/models?limit=1000',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01', // required on every request
        // Required for browser-originated calls; harmless elsewhere.
        'anthropic-dangerous-direct-browser-access': 'true'
      }
    }),
    normalize: (data) => (data?.data || []).map((m) => ({
      id: m.id,
      name: m.display_name || prettifyId(m.id),
      created: Date.parse(m.created_at || '') || 0,
      context: m.max_input_tokens || 0,
      tools: true // every Claude model on this endpoint does tool use
    }))
  },

  openai: {
    needsKey: true,
    request: (key) => ({
      url: 'https://api.openai.com/v1/models',
      headers: { Authorization: `Bearer ${key}` }
    }),
    // OpenAI returns ids only — no display names, no capabilities — and mixes in
    // every embedding/audio/image model, so both the filter and the tool flag
    // have to be inferred from the id.
    normalize: (data) => (data?.data || [])
      .filter((m) => /^(gpt|o\d|chatgpt)/i.test(m.id) && !/instruct/i.test(m.id))
      .map((m) => ({
        id: m.id,
        name: prettifyId(m.id),
        created: (m.created || 0) * 1000,
        tools: /^(gpt-4|gpt-5|gpt-6|o[1-9]|chatgpt-4o)/i.test(m.id)
      }))
  },

  google: {
    needsKey: true,
    request: (key) => ({
      url: `https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&key=${encodeURIComponent(key)}`
    }),
    normalize: (data) => (data?.models || [])
      .filter((m) => Array.isArray(m.supportedGenerationMethods) &&
                     m.supportedGenerationMethods.includes('generateContent'))
      .map((m) => {
        const id = String(m.name || '').replace(/^models\//, '');
        return {
          id,
          name: m.displayName || prettifyId(id),
          created: 0, // models.list exposes no timestamp; ordering uses `version`
          version: parseFloat(m.version) || undefined,
          context: m.inputTokenLimit || 0,
          tools: /^gemini-(?!1\.0)/i.test(id)
        };
      })
      .filter((m) => m.id)
  },

  cohere: {
    needsKey: true,
    request: (key) => ({
      url: 'https://api.cohere.com/v1/models?endpoint=chat&page_size=100',
      headers: { Authorization: `Bearer ${key}` }
    }),
    normalize: (data) => (data?.models || []).map((m) => ({
      id: m.name,
      name: prettifyId(m.name),
      created: 0,
      tools: /^command/i.test(m.name || '')
    }))
  },

  // Ollama / LM Studio / vLLM all speak the OpenAI models route off their own base URL.
  local: {
    needsKey: false,
    needsEndpoint: true,
    request: (_key, endpoint) => ({
      url: String(endpoint || '').replace(/\/(v1\/)?chat\/completions\/?$/, '') + '/v1/models'
    }),
    normalize: (data) => (data?.data || data?.models || []).map((m) => ({
      id: m.id || m.name,
      name: m.id || m.name,
      created: 0,
      tools: true // can't know; assume yes rather than hide the user's own models
    })).filter((m) => m.id)
  }
};

/** Static lists, used only when the live fetch fails (offline, bad key, CORS). */
const FALLBACKS = {
  openrouter: [
    { id: 'anthropic/claude-sonnet-4.5', name: 'Claude Sonnet 4.5' },
    { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
    { id: 'openai/gpt-4o', name: 'GPT-4o' }
  ],
  anthropic: [
    { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5' },
    { id: 'claude-3-5-haiku-latest', name: 'Claude 3.5 Haiku' }
  ],
  openai: [
    { id: 'gpt-4o', name: 'GPT-4o' },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini' }
  ],
  google: [
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' }
  ],
  cohere: [{ id: 'command-r-plus', name: 'Command R+' }],
  local: [],
  custom: []
};

/**
 * Short brand names for prose. `getCommonProviders()` names are menu labels
 * ("OpenRouter (200+ Models)") and read badly mid-sentence; the raw ids are
 * lowercase and read worse.
 */
const PROVIDER_LABELS = {
  openrouter: 'OpenRouter',
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Gemini',
  cohere: 'Cohere',
  local: 'local server',
  custom: 'custom provider'
};

export function getProviderLabel(provider) {
  return PROVIDER_LABELS[provider] || provider || 'provider';
}

const readCache = () => {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const writeCache = (cache) => {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch (err) {
    console.warn('[ModelCatalog] Failed to write cache', err);
  }
};

const fingerprint = async (value) => {
  const str = String(value || '');
  if (!str) return 'none';
  try {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return Array.from(new Uint8Array(digest)).slice(0, 4)
      .map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return `len:${str.length}`;
  }
};

/**
 * Newest first. `created` when the provider gives one, otherwise version parsed
 * from the id; stable releases outrank previews of the same version.
 */
const byRecency = (a, b) => {
  if (a.created && b.created && a.created !== b.created) return b.created - a.created;
  // `version` when the provider reports one (Google), else parsed from the id.
  const va = a.version ?? parseVersion(a.id);
  const vb = b.version ?? parseVersion(b.id);
  if (va !== vb) return vb - va;
  const pa = isPreview(a.id) ? 1 : 0;
  const pb = isPreview(b.id) ? 1 : 0;
  if (pa !== pb) return pa - pb;
  return String(a.id).localeCompare(String(b.id));
};

/**
 * Fetch the live model list for a provider.
 * @returns {Promise<Array|null>} normalized models, or null if unavailable
 */
export async function fetchProviderModels(provider, { apiKey, endpoint, force = false } = {}) {
  const adapter = ADAPTERS[provider];
  if (!adapter) return null;
  if (adapter.needsKey && !String(apiKey || '').trim()) return null;
  if (adapter.needsEndpoint && !String(endpoint || '').trim()) return null;

  const fp = await fingerprint(adapter.needsEndpoint ? endpoint : apiKey);
  const cache = readCache();

  if (!force) {
    const hit = cache[provider];
    if (hit && hit.fingerprint === fp && (Date.now() - hit.fetchedAt) < CACHE_TTL_MS) {
      return hit.models;
    }
  }

  try {
    const { url, headers } = adapter.request(String(apiKey || '').trim(), endpoint);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, { headers: headers || undefined, signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const models = adapter.normalize(await res.json())
      .filter((m) => m.id && !NON_CHAT_PATTERN.test(m.id));

    cache[provider] = { fetchedAt: Date.now(), fingerprint: fp, models };
    writeCache(cache);
    return models;
  } catch (err) {
    console.warn(`[ModelCatalog] Live model fetch failed for ${provider}`, err);
    return null;
  }
}

/** The static fallback list for a provider (sync, always available). */
export function getFallbackModels(provider) {
  return (FALLBACKS[provider] || []).map((m) => ({ ...m, tools: true }));
}

/**
 * The list to actually show in a dropdown: live if we can get it, static if not.
 * Tool-capable only — the wizard is tool-driven, so a model without tool support
 * is a broken selection rather than a limited one.
 *
 * @param {string} provider
 * @param {object} opts
 * @param {string} [opts.apiKey]
 * @param {string} [opts.endpoint]   required for `local`
 * @param {string} [opts.ensureModel] currently-selected id, kept in the list even
 *                                    if it falls outside the shortlist
 * @param {boolean} [opts.force]     bypass the 24h cache
 * @returns {Promise<{models: Array, isLive: boolean, needsKey: boolean}>}
 *   `needsKey` distinguishes "never tried, no credentials" from "tried and failed".
 */
export async function getModelOptions(provider, opts = {}) {
  const adapter = ADAPTERS[provider];
  const needsKey = !!adapter?.needsKey && !String(opts.apiKey || '').trim();

  const live = await fetchProviderModels(provider, opts);
  const isLive = Array.isArray(live) && live.length > 0;
  const source = isLive ? live : getFallbackModels(provider);

  const toolCapable = source.filter((m) => m.tools !== false);
  const usable = toolCapable.length > 0 ? toolCapable : source;

  const shortlist = [...usable].sort(byRecency).slice(0, SHORTLIST_SIZE);

  // A saved model outside the top N must still appear, or the select would snap
  // to "Custom..." on every visit.
  const ensure = String(opts.ensureModel || '').trim();
  if (ensure && !shortlist.some((m) => m.id === ensure)) {
    const known = usable.find((m) => m.id === ensure);
    if (known) shortlist.push(known);
  }

  return { models: shortlist, isLive, needsKey };
}

export default { fetchProviderModels, getFallbackModels, getModelOptions, getProviderLabel };
