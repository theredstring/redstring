import { useCallback, useRef, useState } from 'react';
import {
  requestDeviceCode,
  pollForToken,
  openVerificationUrl
} from '../services/githubDeviceFlow.js';

/**
 * Electron GitHub device-flow orchestration, shared between the Universes
 * panel and the onboarding GitHub wizard. `deviceFlowState` drives the pure
 * GitHubDeviceFlowModal; `cancelRef` is mutated by the poll loop so the user
 * can abort without re-rendering to plumb a fresh cancellation token through.
 */
export function useGitHubDeviceFlow() {
  const [deviceFlowState, setDeviceFlowState] = useState(null);
  const deviceFlowCancelRef = useRef(null);

  /**
   * Runs the full GitHub device flow: requests a code, shows the modal with
   * the user_code, polls in the background, and resolves with the token
   * payload. Throws if the user cancels or the code expires.
   */
  const runDeviceFlow = useCallback(async ({ clientId, scope, title, subtitle }) => {
    if (!clientId) {
      throw new Error('GitHub client_id missing. Set VITE_GITHUB_CLIENT_ID and VITE_GITHUB_APP_CLIENT_ID at build time.');
    }

    const cancelSignal = { cancelled: false };
    deviceFlowCancelRef.current = cancelSignal;

    let code;
    try {
      code = await requestDeviceCode({ clientId, scope });
    } catch (err) {
      deviceFlowCancelRef.current = null;
      throw err;
    }

    setDeviceFlowState({
      title,
      subtitle,
      userCode: code.userCode,
      verificationUri: code.verificationUri,
      verificationUriComplete: code.verificationUriComplete,
      expiresAt: code.expiresAt,
      status: 'pending',
      errorMessage: null
    });

    // Auto-open browser to save the user one click. They can still copy
    // the code manually from the modal if their browser launch fails.
    openVerificationUrl(code.verificationUriComplete || code.verificationUri).catch(() => {});

    try {
      const tokenData = await pollForToken({
        clientId,
        deviceCode: code.deviceCode,
        intervalMs: code.intervalMs,
        expiresAt: code.expiresAt,
        cancelSignal,
        onTick: (status) => {
          setDeviceFlowState((prev) => prev ? { ...prev, status } : prev);
        }
      });
      return tokenData;
    } finally {
      deviceFlowCancelRef.current = null;
      setDeviceFlowState(null);
    }
  }, []);

  const cancelDeviceFlow = useCallback(() => {
    if (deviceFlowCancelRef.current) {
      deviceFlowCancelRef.current.cancelled = true;
    }
    setDeviceFlowState(null);
  }, []);

  return { deviceFlowState, runDeviceFlow, cancelDeviceFlow };
}

export default useGitHubDeviceFlow;
