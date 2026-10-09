/**
 * When the browser rebuilds and uploads the bridge state: not on a timer
 * whatever happened, which stalled a big universe every 10 s, and not again
 * after the server has refused the universe as too large.
 */
import { describe, it, expect } from 'vitest';
import { createBridgeSendGate, MAX_BRIDGE_STATE_BYTES } from '../../src/services/bridgeStateSerializer.js';

const things = (n) => new Map(Array.from({ length: n }, (_, i) => [`p${i}`, { id: `p${i}` }]));
const store = (patch = {}) => ({ graphs: new Map(), nodePrototypes: things(3), edges: new Map(), activeGraphId: 'g', openGraphIds: ['g'], autoLayoutSettings: {}, ...patch });

describe('the bridge send gate', () => {
  it('builds the first time, then skips until something the payload reads changes', () => {
    const gate = createBridgeSendGate();
    const s1 = store();
    expect(gate.skipReason(s1)).toBe(null);
    gate.sent(s1);
    expect(gate.skipReason(s1)).toBe('unchanged');
    // Pan, zoom, selection: a new store object, the same data.
    expect(gate.skipReason({ ...s1, selection: ['x'] })).toBe('unchanged');
    expect(gate.skipReason({ ...s1, nodePrototypes: new Map(s1.nodePrototypes) })).toBe(null);
    expect(gate.skipReason({ ...s1, activeGraphId: 'h' })).toBe(null);
  });

  it('tries again after a failed upload or a reconnect', () => {
    const gate = createBridgeSendGate();
    const s1 = store();
    gate.sent(s1);
    gate.failed();
    expect(gate.skipReason(s1)).toBe(null);
  });

  it('stops building a universe too big to upload until it gets well smaller', () => {
    const gate = createBridgeSendGate();
    const big = store({ nodePrototypes: things(1000) });
    gate.tooLarge(big);
    expect(gate.skipReason(big)).toBe('too-large');
    // Edits that keep it about as big don't retry.
    expect(gate.skipReason(store({ nodePrototypes: things(950) }))).toBe('too-large');
    expect(gate.skipReason(store({ nodePrototypes: things(700) }))).toBe(null);
  });

  it('stays under what the wizard server accepts', () => {
    expect(createBridgeSendGate().maxBytes).toBe(MAX_BRIDGE_STATE_BYTES);
    expect(MAX_BRIDGE_STATE_BYTES).toBeLessThan(20 * 1024 * 1024);
  });
});
