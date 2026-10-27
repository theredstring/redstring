/**
 * bridgeApply.js
 *
 * Applies a pending bridge action through the wizard's applier and builds what
 * the bridge reports back for it (the action-completed result the MCP server
 * reads). The browser bridge (BridgeClient) and the headless runtime both use
 * it, so a tool call over MCP hears what really happened:
 *  - ok: false, with the failures, when the apply failed;
 *  - held: true when it waits on the person's OK (wizardConfirmationGate);
 *  - applied: the ids the apply handed back (a formula's group and Thing).
 * A bank formula loads the bank first; the report waits for its build.
 *
 * Imports graphStore through the applier, so the headless runtime imports this
 * after its localStorage shim, as it does the applier.
 */
import { applyToolResultToStore, collectApplyFailuresSettled } from './toolResultApplier.js';
import { useWizardConfirmationStore } from './wizardConfirmationGate.js';

/** The result-like object the applier takes, from a pending action's params. */
export function bridgeResultObject(action, params) {
  if (Array.isArray(params) && params.length === 1) return { action, ...params[0] };
  return { action, ...params };
}

// Top-level ids and plain values only: the applier's return can hold whole
// objects (a formula's matched Thing), and the report goes over HTTP.
function plainFields(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const out = {};
  for (const [key, v] of Object.entries(value)) {
    if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) out[key] = v;
    else if (Array.isArray(v) && v.every(x => typeof x === 'string' || typeof x === 'number')) out[key] = [...v];
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Build the report for an apply. `resultObj` is what the tool produced;
 * `failures` what the applier raised; `value` what it returned; `held`
 * whether it waits on the person.
 */
export function bridgeApplyReport(resultObj, { failures = [], value, held = false } = {}) {
  const reasons = failures.map(f => f?.reason).filter(Boolean);
  if (resultObj?.error) reasons.unshift(String(resultObj.error));
  const report = { ...resultObj, ok: reasons.length === 0 && !held };
  if (reasons.length > 0) {
    report.applyFailures = reasons;
    report.error = reasons.join(' ');
  }
  if (held) {
    report.held = true;
    report.status = 'awaiting_confirmation';
    report.message = 'Held for the person to confirm in Redstring; nothing has changed yet.';
  }
  const applied = plainFields(value);
  if (applied) report.applied = applied;
  return report;
}

/** Apply one pending action (not a storeActions one) and report what happened. */
export async function applyBridgeAction(action, params, actionId = null) {
  const resultObj = bridgeResultObject(action, params);
  const { failures, value } = await collectApplyFailuresSettled(() => applyToolResultToStore(action, resultObj, actionId));
  const held = !!actionId && (useWizardConfirmationStore.getState().pending || []).some(e => e.toolCallId === actionId);
  return bridgeApplyReport(resultObj, { failures, value, held });
}
