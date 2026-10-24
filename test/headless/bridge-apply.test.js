// @vitest-environment node
/**
 * What the bridge reports back for an applied action (bridgeApply.js), and how
 * the MCP server folds it into a tool's result (bridgeOutcome.js). A change
 * that failed, was held, or was never confirmed must not come back as done.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
// Building a formula measures its Things' names: the layout bench's canvas shim.
import '../layout-bench/env.js';
import { createHeadlessStore, __resetHeadlessStoreCache } from '../../src/headless/createHeadlessStore.js';
import { settleBridgeResult, queuedActionId } from '../../src/services/bridgeOutcome.js';

let useGraphStore;
let applyBridgeAction;
let formulaBankNow;
let actions;

beforeAll(async () => {
  __resetHeadlessStoreCache();
  ({ useGraphStore } = await createHeadlessStore());
  // After the shim: these import graphStore.
  ({ applyBridgeAction } = await import('../../src/services/bridgeApply.js'));
  ({ formulaBankNow } = await import('../../src/components/canvas/formats/formula/bank/formulaBank.js'));
  const { createStoreActions } = await import('../../src/services/storeActions.js');
  actions = createStoreActions({ useGraphStore });
  useGraphStore.getState().createNewGraph({ id: 'g-bridge', name: 'Bridge Web' });
  for (const k of ['log', 'warn', 'error', 'info', 'debug']) vi.spyOn(console, k).mockImplementation(() => {});
});

describe('applyBridgeAction', () => {
  it('reports ok with the tool result when the apply works', async () => {
    const report = await applyBridgeAction('createGraph', [{ graphId: 'g-made', graphName: 'Made', created: true }], 'pa-1');
    expect(report.ok).toBe(true);
    expect(report.created).toBe(true);
    expect(useGraphStore.getState().graphs.has('g-made')).toBe(true);
  });

  it('reports ok false with the failure when the apply fails', async () => {
    const report = await applyBridgeAction('updateEdge', [{
      graphId: 'g-bridge', sourceName: 'Nobody', targetName: 'Nothing', updates: { type: 'Relates' },
    }], 'pa-2');
    expect(report.ok).toBe(false);
    expect(report.applyFailures).toHaveLength(1);
    expect(report.error).toMatch(/Could not find nodes "Nobody" and "Nothing"/);
  });

  it('waits for a bank formula to load the bank, and reports a bank miss as failed', async () => {
    expect(formulaBankNow()).toBe(null); // so the build goes through the async load
    const report = await applyBridgeAction('addFormula', [{ graphId: 'g-bridge', bankId: 'Q-no-such-equation' }], 'pa-3');
    expect(report.ok).toBe(false);
    expect(report.error).toMatch(/No equation "Q-no-such-equation"/);
  });

  it('reports the ids a bank formula build hands back', async () => {
    const report = await applyBridgeAction('addFormula', [{ graphId: 'g-bridge', bankId: 'Q191785' }], 'pa-4');
    expect(report.error).toBeUndefined();
    expect(report.ok).toBe(true);
    expect(report.applied?.equationProtoId).toBeTruthy();
    expect(useGraphStore.getState().nodePrototypes.has(report.applied.equationProtoId)).toBe(true);
  });
});

describe('applyMutations', () => {
  it('takes removeNodeInstance as deleteNodeInstance', async () => {
    const st = useGraphStore.getState();
    st.addNodePrototype({ id: 'p-rm', name: 'Removable' });
    st.addNodeInstance('g-bridge', 'p-rm', { x: 0, y: 0 }, 'i-rm');
    const res = await actions.applyMutations([{ type: 'removeNodeInstance', graphId: 'g-bridge', instanceId: 'i-rm' }]);
    expect(res.success).toBe(true);
    expect(res.results[0]).toMatchObject({ type: 'removeNodeInstance', ok: true });
    expect(useGraphStore.getState().graphs.get('g-bridge').instances.has('i-rm')).toBe(false);
  });

  it('is not a success when any operation fails, and names it', async () => {
    const res = await actions.applyMutations([
      { type: 'updateGraph', graphId: 'g-bridge', updates: { name: 'Bridge Web' } },
      { type: 'frobnicate' },
      { type: 'deleteNodeInstance', graphId: 'g-bridge', instanceId: 'i-gone' },
    ]);
    expect(res.success).toBe(false);
    expect(res.failedCount).toBe(2);
    expect(res.error).toMatch(/frobnicate \(Unknown operation type\)/);
    expect(res.error).toMatch(/deleteNodeInstance \(Missing instance\/graph\)/);
  });
});

describe('settleBridgeResult', () => {
  const enq = { ok: true, actionIds: ['pa-open', 'pa-batch'] };

  it('reads the last queued id (an openGraph can go ahead of a batch)', () => {
    expect(queuedActionId(enq)).toBe('pa-batch');
    expect(queuedActionId({ ok: true, actionIds: [] })).toBe(null);
  });

  it('merges a good ack', () => {
    const out = settleBridgeResult({ created: true, name: 'X' }, enq, { completed: true, results: { 'pa-batch': { ok: true, applied: { groupId: 'g1' } } } }, 'pa-batch');
    expect(out.isError).toBe(false);
    expect(out.result).toMatchObject({ created: true, ok: true, applied: { groupId: 'g1' } });
  });

  it('turns a failed ack into an error with the reason, flags off', () => {
    const out = settleBridgeResult({ created: true }, enq, { completed: true, results: { 'pa-batch': { ok: false, error: 'No web to work in' } } }, 'pa-batch');
    expect(out.isError).toBe(true);
    expect(out.result).toMatchObject({ created: false, ok: false, status: 'failed', error: 'No web to work in' });
  });

  it('names the failed operations of a batch', () => {
    const ack = { success: false, results: [{ type: 'addEdge', ok: true }, { type: 'frobnicate', ok: false, error: 'Unknown operation type' }] };
    const out = settleBridgeResult({ success: true, count: 2 }, enq, { completed: true, results: { 'pa-batch': ack } }, 'pa-batch');
    expect(out.isError).toBe(true);
    expect(out.result.success).toBe(false);
    expect(out.result.error).toMatch(/frobnicate: Unknown operation type/);
  });

  it('says so when the app never confirmed', () => {
    const out = settleBridgeResult({ deleted: true }, enq, { completed: false, timedOut: true, results: {} }, 'pa-batch');
    expect(out.isError).toBe(true);
    expect(out.result).toMatchObject({ deleted: false, status: 'timed_out' });
    expect(out.result.error).toMatch(/did not confirm/);
  });

  it('a held change is not done, and not an error', () => {
    const out = settleBridgeResult({ deleted: true }, enq, { completed: true, results: { 'pa-batch': { ok: false, held: true, status: 'awaiting_confirmation' } } }, 'pa-batch');
    expect(out.isError).toBe(false);
    expect(out.result).toMatchObject({ deleted: false, held: true, status: 'awaiting_confirmation' });
  });

  it('a change that never queued is an error', () => {
    const out = settleBridgeResult({ created: true }, { ok: false, error: 'actions[] required' }, null, null);
    expect(out.isError).toBe(true);
    expect(out.result.error).toMatch(/Could not queue/);
  });
});
