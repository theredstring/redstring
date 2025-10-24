/**
 * Cross-environment helper for creating abort signals with timeouts.
 * Falls back to AbortController when AbortSignal.timeout is not available.
 */
export function createTimeoutSignal(timeoutMs) {
  if (typeof timeoutMs !== 'number' || timeoutMs <= 0) {
    return { signal: undefined, cleanup: () => {} };
  }

  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    try {
      const signal = AbortSignal.timeout(timeoutMs);
      return { signal, cleanup: () => {} };
    } catch (error) {
      // Fall back to manual controller below
    }
  }

  if (typeof AbortController === 'undefined') {
    return { signal: undefined, cleanup: () => {} };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const cleanup = () => {
    clearTimeout(timeoutId);
  };

  if (controller.signal?.addEventListener) {
    controller.signal.addEventListener('abort', cleanup, { once: true });
  }

  return { signal: controller.signal, cleanup };
}
