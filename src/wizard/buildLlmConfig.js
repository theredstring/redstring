/**
 * buildLlmConfig — the single place the agent's runtime config is assembled.
 *
 * Lifted out of wizard-server.js when the agent loop moved in-app, so the
 * browser and the server cannot drift apart on the two things here that are
 * not obvious: the per-tier iteration clamp and the per-ask token budget.
 * Both are cost ceilings, not preferences — a bad config must not be able to
 * produce a runaway bill on either side.
 *
 * Imported by the browser. No Node builtins.
 */

/**
 * Per-tier iteration limit, clamped to a HARD ceiling.
 *
 * 0 / negative / ∞ intent maps to the tier ceiling — NOT the old 9999 footgun.
 * Defaults: 177 local/small, 77 cloud/large. Ceilings: 300 local (cheap),
 * 100 cloud (costs money; the 77 default fits comfortably under it).
 */
export function resolveMaxIterations(apiConfig = {}) {
  const isSmall = apiConfig.modelTier === 'small';
  const ceiling = isSmall ? 300 : 100;
  const dflt = isSmall ? 177 : 77;
  const configured = isSmall
    ? apiConfig.settings?.maxIterationsLocal
    : apiConfig.settings?.maxIterationsCloud;

  let n = dflt;
  if (configured != null && Number.isFinite(Number(configured))) {
    n = Math.floor(Number(configured));
  }
  if (n <= 0) n = ceiling;
  return Math.min(Math.max(1, n), ceiling);
}

/**
 * Hard per-ask token budget — a cost ceiling independent of iteration count.
 * The loop aborts once cumulative usage crosses this.
 */
export function resolveMaxAskTokens(apiConfig = {}) {
  const HARD_CEILING = 2000000;
  const DEFAULT = 500000;
  const configured = apiConfig.settings?.maxAskTokens;

  let n = DEFAULT;
  if (configured != null && Number.isFinite(Number(configured)) && Number(configured) > 0) {
    n = Math.floor(Number(configured));
  }
  return Math.min(n, HARD_CEILING);
}

/**
 * Assemble the config object `runAgent` expects.
 *
 * @param {Object}   params
 * @param {string}   params.apiKey
 * @param {Object}   params.apiConfig            provider/model/settings/modelTier
 * @param {string}   [params.cid]                conversation id; generated if absent
 * @param {string}   [params.systemPrompt]       overrides the built-in prompt
 * @param {Array}    [params.contextItems]
 * @param {Array}    [params.conversationHistory]
 */
export function buildLlmConfig({
  apiKey,
  apiConfig: rawApiConfig,
  cid,
  systemPrompt,
  contextItems = [],
  conversationHistory = []
} = {}) {
  // Callers pass `config.apiConfig` straight through, and that is explicitly
  // null when the user has no provider configured — a default parameter would
  // not catch it.
  const apiConfig = rawApiConfig || {};
  return {
    apiKey,
    provider: apiConfig.provider || 'openrouter',
    endpoint: apiConfig.endpoint,
    model: apiConfig.model,
    temperature: apiConfig.settings?.temperature,
    maxTokens: apiConfig.settings?.max_tokens,
    modelTier: apiConfig.modelTier || 'large',
    cid: cid || `wizard-${Date.now()}`,
    conversationHistory,
    systemPrompt,
    maxIterations: resolveMaxIterations(apiConfig),
    maxAskTokens: resolveMaxAskTokens(apiConfig),
    contextItems
  };
}

export default buildLlmConfig;
