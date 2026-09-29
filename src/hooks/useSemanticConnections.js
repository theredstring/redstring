import { useEffect, useMemo, useState, useCallback } from 'react';
import { getSemanticConnections } from '../services/semanticSearchEngine.js';

/**
 * What the semantic web says about a seed (a prototype or a concept), for a
 * component to show. Streams as each source lands; drops a stale answer when
 * the seed changes underneath it.
 *
 * @param {Object|null} seed
 * @param {{ enabled?: boolean }} [options]
 * @returns {{ status: 'idle'|'loading'|'ready'|'unresolved'|'error', identity, connections: Array, retry: Function }}
 */
export default function useSemanticConnections(seed, { enabled = true } = {}) {
  // Re-run when WHICH subject this is changes — its name or its links — not on
  // every edit to the object holding them.
  const seedKey = useMemo(() => {
    if (!seed) return null;
    const links = [
      seed.uri, seed.semanticMetadata?.originalUri,
      ...(seed.externalLinks || []).map((l) => (typeof l === 'string' ? l : l?.url || l?.uri)),
      ...(seed.semanticMetadata?.externalLinks || [])
    ].filter(Boolean);
    return `${seed.name || ''}|${[...new Set(links)].sort().join(',')}`;
  }, [seed]);

  const [state, setState] = useState({ status: 'idle', identity: null, connections: [] });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    if (!enabled || !seed || !seedKey) {
      setState({ status: 'idle', identity: null, connections: [] });
      return undefined;
    }
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    let live = true;
    setState({ status: 'loading', identity: null, connections: [] });

    getSemanticConnections(seed, {
      signal: controller?.signal,
      refresh: attempt > 0,
      onProgress: ({ identity, connections }) => {
        if (live) setState({ status: 'loading', identity, connections });
      }
    }).then(({ identity, connections }) => {
      if (!live) return;
      const unresolved = !identity.qid && !identity.dbpediaUri;
      setState({ status: unresolved ? 'unresolved' : 'ready', identity, connections });
    }).catch((err) => {
      if (!live || err?.name === 'AbortError') return;
      console.warn('[useSemanticConnections] Failed:', err);
      setState((prev) => ({ ...prev, status: 'error' }));
    });

    return () => {
      live = false;
      controller?.abort();
    };
    // `seed` is read through seedKey on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedKey, enabled, attempt]);

  return { ...state, retry };
}
