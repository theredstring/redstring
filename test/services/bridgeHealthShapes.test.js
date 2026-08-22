import { describe, it, expect } from 'vitest';

/**
 * BridgeClient decides whether a bridge exists by inspecting the body of
 * /api/bridge/health, because status alone is not enough: a static host
 * (Cloudflare Pages) answers unknown /api/* paths with the SPA fallback —
 * 200 + index.html — which reads as "healthy" and sends the client into an
 * unbounded reconnect loop.
 *
 * Two server implementations answer that route with DIFFERENT shapes, and
 * accepting only one silently kills the bridge on the other platform:
 *   wizard-server.js      (Electron, local dev) -> { status: 'ok', source: ... }
 *   ai-bridge-service.js  (hosted)              -> { ok: true, hasStore: ... }
 *
 * This mirrors the predicate in BridgeClient.checkBridgeHealth. If that
 * predicate changes, change it here too — deliberately.
 */
const isHealthyPayload = (data) => {
  if (data?.bridgeAvailable === false) return false;
  return data?.ok === true || data?.status === 'ok';
};

describe('bridge health payload detection', () => {
  it('accepts the wizard-server shape used by Electron and local dev', () => {
    expect(isHealthyPayload({
      status: 'ok',
      source: 'wizard-server',
      headless: false,
      storeMode: 'browser'
    })).toBe(true);
  });

  it('accepts the ai-bridge-service shape', () => {
    expect(isHealthyPayload({ ok: true, hasStore: true })).toBe(true);
  });

  it('rejects a deployment that reports the bridge as deliberately absent', () => {
    expect(isHealthyPayload({
      ok: false,
      bridgeAvailable: false,
      error: 'Bridge endpoints are not available on this deployment'
    })).toBe(false);
  });

  it('rejects an explicit unavailable flag even alongside an ok status', () => {
    expect(isHealthyPayload({ status: 'ok', bridgeAvailable: false })).toBe(false);
  });

  it('rejects anything that is not a bridge answering', () => {
    // What JSON.parse would yield for the SPA fallback is nothing at all —
    // it throws — but a stray HTML-ish or empty body must not read as healthy.
    expect(isHealthyPayload(null)).toBe(false);
    expect(isHealthyPayload(undefined)).toBe(false);
    expect(isHealthyPayload({})).toBe(false);
    expect(isHealthyPayload({ status: 'error' })).toBe(false);
    expect(isHealthyPayload({ ok: 'yes' })).toBe(false);
  });
});
