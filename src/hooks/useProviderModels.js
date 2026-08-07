import { useEffect, useState, useCallback, useRef } from 'react';
import apiKeyManager from '../services/apiKeyManager.js';
import { getModelOptions } from '../services/modelCatalog.js';

/**
 * Live model list for the currently-selected provider.
 *
 * Starts from the static fallback so the dropdown is never empty, then swaps in
 * the provider's real catalog once fetched. When the form's key field is blank
 * (editing an existing config shows a masked key) it falls back to the stored
 * key *for that provider* — not the active profile's, which would be a
 * different provider's key and just 401s.
 *
 * @param {string} provider
 * @param {string} apiKey        key currently typed into the form, may be blank
 * @param {string} endpoint      needed for `local` providers
 * @param {string} selectedModel kept in the list even if outside the shortlist
 */
export function useProviderModels(provider, apiKey, endpoint, selectedModel) {
  const [models, setModels] = useState([]);
  const [isLive, setIsLive] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  // True when the fetch was skipped for want of a key, as opposed to attempted
  // and failed — the two need different messages in the UI.
  const [needsKey, setNeedsKey] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  // Read inside the effect without making it a dependency: re-running on every
  // keystroke of a custom model name would refetch pointlessly.
  const selectedRef = useRef(selectedModel);
  selectedRef.current = selectedModel;
  const forceRef = useRef(false);

  useEffect(() => {
    if (!provider || provider === 'custom') {
      setModels([]);
      setIsLive(false);
      setNeedsKey(false);
      return undefined;
    }

    let cancelled = false;
    setIsLoading(true);

    // Debounced: the key field fires this on every keystroke while pasting.
    const timer = setTimeout(async () => {
      let key = String(apiKey || '').trim();
      if (!key) {
        try { key = await apiKeyManager.getAPIKeyForProvider(provider); } catch { key = null; }
      }

      // Consume the force flag so only the refresh-triggered run bypasses cache.
      const force = forceRef.current;
      forceRef.current = false;

      try {
        const result = await getModelOptions(provider, {
          apiKey: key,
          endpoint,
          ensureModel: selectedRef.current,
          force
        });
        if (cancelled) return;
        setModels(result.models);
        setIsLive(result.isLive);
        setNeedsKey(result.needsKey);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }, 400);

    return () => { cancelled = true; clearTimeout(timer); setIsLoading(false); };
  }, [provider, apiKey, endpoint, refreshToken]);

  const refresh = useCallback(() => setRefreshToken((n) => n + 1), []);

  return { models, isLive, isLoading, needsKey, refresh };
}

export default useProviderModels;
