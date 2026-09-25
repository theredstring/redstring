/**
 * One-shot suggestions (moved verbatim from NodeCanvas): a model's guess for a
 * new connection's name, an abstraction's name and an arrow direction. No model,
 * a timeout or a malformed reply leaves things exactly as they were.
 */
import { isOneShotAvailable, oneShotLabel } from '../../../services/oneShot.js';
import { suggestAbstractionName, suggestArrowDirection } from '../../../wizard/tools/utils/suggestionCalls.js';

/** Fill a blank connection-name prompt with a suggestion. */
export function suggestConnectionName(ctx) {
  const {
    connectionNamePrompt, edgesMap, nodeById, nodePrototypesMap, connectionSuggestionRef,
    setConnectionNamePrompt,
  } = ctx;
  if (!connectionNamePrompt.visible || !connectionNamePrompt.edgeId) return;
  if (connectionNamePrompt.name && connectionNamePrompt.name.trim()) return;

  const edgeId = connectionNamePrompt.edgeId;
  let cancelled = false;

  (async () => {
    try {
      if (!(await isOneShotAvailable())) return;
      const edge = edgesMap.get(edgeId);
      if (!edge) return;
      const sourceName = nodeById.get(edge.sourceId)?.name || '';
      const targetName = nodeById.get(edge.destinationId || edge.targetId)?.name || '';
      if (!sourceName || !targetName) return;

      // Existing connection-type names, offered to the model to prefer reuse.
      const typeNames = new Set();
      for (const e of edgesMap.values()) {
        for (const pid of (e.definitionNodeIds || [])) {
          const p = nodePrototypesMap.get(pid);
          if (p?.name) typeNames.add(p.name);
        }
      }
      const existing = Array.from(typeNames).slice(0, 20);

      const result = await oneShotLabel({
        callSite: 'edgeLabelSuggestion',
        instruction:
          'Suggest a short connection label (a verb phrase) for how the source relates to the target, read source → target. ' +
          (existing.length ? `Prefer reusing one of these existing types if one fits: ${existing.join(', ')}. ` : '') +
          'Examples: "directed by", "is a kind of", "causes".',
        input: `${sourceName} → ${targetName}`,
        maxWords: 4,
        timeoutMs: 4000
      });
      if (cancelled || !result?.value) return;

      // Store first so outcome logging works even under StrictMode double-invoke.
      const suggestionRecord = { edgeId, suggestion: result.value, callId: result.callId, applied: false };
      connectionSuggestionRef.current = suggestionRecord;

      // User input always wins: only pre-fill if still open for THIS edge and untouched.
      setConnectionNamePrompt((prev) => {
        if (prev.visible && prev.edgeId === edgeId && (!prev.name || !prev.name.trim())) {
          suggestionRecord.applied = true;
          return { ...prev, name: result.value };
        }
        return prev;
      });
    } catch {
      // Never disrupt the prompt.
    }
  })();

  return () => { cancelled = true; };
}

/** Fill a blank abstraction-name prompt with a suggestion. */
export function fillAbstractionNameSuggestion(ctx) {
  const { abstractionPrompt, nodePrototypesMap, abstractionSuggestionRef, setAbstractionPrompt } = ctx;
  if (!abstractionPrompt.visible || !abstractionPrompt.nodeId) return;
  if (abstractionPrompt.name && abstractionPrompt.name.trim()) return;

  const { nodeId, direction } = abstractionPrompt;
  let cancelled = false;

  (async () => {
    try {
      if (!(await isOneShotAvailable())) return;
      const nodeName = nodePrototypesMap.get(nodeId)?.name || '';
      if (!nodeName) return;
      const moreGeneral = direction === 'below'; // app: below = more general

      const result = await suggestAbstractionName({
        nodeName,
        moreGeneral,
        timeoutMs: 4000
      });
      if (cancelled || !result?.name) return;

      const record = { nodeId, direction, suggestion: result.name, callId: result.callId, applied: false };
      abstractionSuggestionRef.current = record;

      setAbstractionPrompt((prev) => {
        if (prev.visible && prev.nodeId === nodeId && prev.direction === direction && (!prev.name || !prev.name.trim())) {
          record.applied = true;
          return { ...prev, name: result.name };
        }
        return prev;
      });
    } catch {
      // Never disrupt the prompt.
    }
  })();

  return () => { cancelled = true; };
}

/** Suggest which way a newly named connection's arrow should point. */
export function suggestEdgeArrowDirectionWith(ctx, edgeId, label) {
  const { edgesMap, nodeById, storeActions } = ctx;
  if (!edgeId || !label || !label.trim()) return;
  (async () => {
    try {
      if (!(await isOneShotAvailable())) return;
      const edge = edgesMap.get(edgeId);
      if (!edge) return;
      // User already set a direction → leave it alone.
      if (edge.directionality?.arrowsToward && edge.directionality.arrowsToward.size > 0) return;
      const sourceInstId = edge.sourceId;
      const targetInstId = edge.destinationId || edge.targetId;
      const sourceName = nodeById.get(sourceInstId)?.name || '';
      const targetName = nodeById.get(targetInstId)?.name || '';
      if (!sourceName || !targetName) return;

      const dir = await suggestArrowDirection({ sourceName, targetName, label: label.trim(), timeoutMs: 4000 });
      if (!dir) return;
      const towardId = dir.arrowsToward === 'source' ? sourceInstId : targetInstId;
      // Its own labelled entry: this resolves asynchronously, so folding it
      // into whatever the user is doing when the model answers would attribute
      // it to an unrelated action.
      storeActions.updateEdge(edgeId, (draft) => {
        if (!draft.directionality) draft.directionality = { arrowsToward: new Set() };
        if (!draft.directionality.arrowsToward) draft.directionality.arrowsToward = new Set();
        // User input always wins: never override a direction already set.
        if (draft.directionality.arrowsToward.size > 0) return;
        draft.directionality.arrowsToward = new Set([towardId]);
      }, { historyLabel: 'Suggested connection direction' });
    } catch {
      // Never disrupt connection creation.
    }
  })();
}
