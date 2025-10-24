import { useEffect, useRef, useState } from 'react';
import useGraphStore from "../store/graphStore.jsx";
import { bridgeEventSource, bridgeFetch } from '../services/bridgeConfig.js';

// Projection store: replaces UI state wholesale upon commit events
export default function useProjectionStore() {
  const [connected, setConnected] = useState(false);
  const sseRef = useRef(null);

  useEffect(() => {
    try {
      const es = bridgeEventSource('/events/stream');
      sseRef.current = es;
      es.onopen = () => setConnected(true);
      es.onerror = () => setConnected(false);
      es.addEventListener('PATCH_APPLIED', async (e) => {
        try {
          // On commit, ask bridge for full canonical projection (fallback until we host snapshots)
          const resp = await bridgeFetch('/api/bridge/state');
          if (!resp.ok) return;
          const bridge = await resp.json();
          // Replace UI projection wholesale where possible
          // If a universe snapshot endpoint is added, prefer that. For now, keep using store (minimal set).
          // This keeps UI a projection that only reacts to committed changes.
          const store = useGraphStore.getState();
          // Projection refresh can be more granular later; currently, rely on emitted applyMutations already executed.
          // No-op here as applyMutations is applied via MCPBridge; this hook ensures future SSE-based updates.
        } catch {}
      });
      return () => { try { es.close(); } catch {} };
    } catch {
      setConnected(false);
    }
  }, []);

  return { connected };
}


