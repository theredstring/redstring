import { useEffect, useMemo, useRef } from 'react';
import useImageCache, { cancelThumbnailFetch, queueThumbnailFetch } from '../../../services/imageCache.js';
import { NODE_DEFAULT_COLOR } from '../../../constants';

/** The active graph's hydrated nodes and the effects that keep its data whole: group anchors repaired and orphans swept, the image cache reconciled with the prototypes, and a missing graph re-created (moved verbatim from NodeCanvas, wave 6). */
export function useActiveGraphData({
  activeGraph, activeGraphId, activeGraphInstances, graphsMap, imageCacheMap, nodePrototypesMap,
  storeActions,
}) {
  // Repair node-groups missing their anchor instance. Node-groups need an anchor (the
  // invisible instance edges connect to) to be a usable connection target. Legacy files,
  // and groups created via paths that set linkedNodePrototypeId without minting an anchor,
  // load without one — making them impossible to connect from/to. ensureGroupAnchor is
  // idempotent, so this settles after a single pass per graph.
  useEffect(() => {
    if (!activeGraphId || !activeGraph?.groups) return;
    const brokenGroupIds = [];
    activeGraph.groups.forEach((group, groupId) => {
      if (!group.linkedNodePrototypeId) return;
      if (!group.anchorInstanceId || !activeGraphInstances?.has(group.anchorInstanceId)) {
        brokenGroupIds.push(groupId);
        return;
      }
      // A memberless node-group with no frozen shell origin lays out to ok:false, so the
      // shell is skipped — and its anchor is hidden from the node layer for being an
      // anchor, leaving the Thing with nothing on canvas at all. ensureGroupAnchor seeds
      // the origin on its idempotent path; see seedEmptyPlaceholderOrigin.
      const hasMember = (group.memberInstanceIds || []).some(id => activeGraphInstances?.has(id));
      if (!hasMember && !group.emptyPlaceholderOrigin) {
        brokenGroupIds.push(groupId);
      }
    });
    if (brokenGroupIds.length === 0) return;
    brokenGroupIds.forEach(groupId => storeActions.ensureGroupAnchor(activeGraphId, groupId));
  }, [activeGraphId, activeGraph?.groups, activeGraphInstances, storeActions]);

  // Sweep the reverse case: anchor instances left holding the flag with no group that
  // names them back — the group is gone, it anchors a different instance now, or the
  // anchorForGroupId was lost. All three are hidden from rendering unconditionally, so
  // without this they stay invisible-but-connected indefinitely (visible only while
  // singly selected, which takes a render path that doesn't check the flag).
  useEffect(() => {
    if (!activeGraphId || !activeGraphInstances) return;
    let hasOrphan = false;
    for (const inst of activeGraphInstances.values()) {
      if (!inst.isGroupAnchor) continue;
      const group = inst.anchorForGroupId ? activeGraph?.groups?.get(inst.anchorForGroupId) : null;
      if (!group || group.anchorInstanceId !== inst.id) {
        hasOrphan = true;
        break;
      }
    }
    if (!hasOrphan) return;
    storeActions.cleanupOrphanedGroupAnchors(activeGraphId);
  }, [activeGraphId, activeGraph?.groups, activeGraphInstances, storeActions]);

  // Hydrated nodes for the active graph: prototype + cached image + instance, nothing
  // derived (unlike `nodes`) and never stale. An object is reused only when its
  // instance, prototype and cache entry are the same objects (Immer keeps untouched ones).
  const hydratedPrevRef = useRef({ byId: new Map(), list: [] });
  const hydratedNodes = useMemo(() => {
    if (!activeGraphId || !activeGraphInstances || !nodePrototypesMap) return [];
    const prev = hydratedPrevRef.current;
    const byId = new Map(), list = [];
    for (const [id, instance] of activeGraphInstances) {
      const prototype = nodePrototypesMap.get(instance.prototypeId);
      if (!prototype) continue;
      const cached = imageCacheMap[instance.prototypeId]; // auto-enriched thumbnails live outside the store
      const was = prev.byId.get(id);
      const node = (was && was.instance === instance && was.prototype === prototype && was.cached === cached)
        ? was.node
        : { ...prototype, ...((cached && !prototype.thumbnailSrc) ? { thumbnailSrc: cached.thumbnailSrc, imageAspectRatio: cached.imageAspectRatio } : {}), ...instance };
      byId.set(id, { instance, prototype, cached, node });
      list.push(node);
    }
    const same = prev.list.length === list.length && list.every((n, i) => n === prev.list[i]);
    hydratedPrevRef.current = { byId, list: same ? prev.list : list };
    return same ? prev.list : list;
  }, [activeGraphId, activeGraphInstances, nodePrototypesMap, imageCacheMap]);

  // Reconcile the image cache against the prototypes of the active graph.
  //
  // imageCache is never saved, so the Wikipedia URL in semanticMetadata is the
  // source of truth and the cache is derived from it. This keeps the two in
  // sync in BOTH directions:
  //   - URL present, nothing cached  → fetch it (file load, undo of a deletion)
  //   - URL gone, something cached   → drop it (redo of a deletion)
  // Running this only on activeGraphId meant undo restored the URL but nothing
  // re-fetched, so a deleted image stayed missing from the canvas until reload.
  // Driving it off nodePrototypesMap instead catches every path that changes an
  // image — undo, redo, jumpTo, wizard edits — rather than enumerating them.
  //
  // Depending on nodePrototypesMap does NOT loop the way depending on
  // imageCacheMap would: setImage changes only the cache, which this effect no
  // longer reads reactively, so the write cannot retrigger the effect.
  // OPTIMIZED: Only touch prototypes actually used in the active graph.
  useEffect(() => {
    if (!nodePrototypesMap || !activeGraphInstances) return;
    const cache = useImageCache.getState();
    // Build set of prototype IDs in the active graph
    const activeProtoIds = new Set();
    for (const instance of activeGraphInstances.values()) {
      activeProtoIds.add(instance.prototypeId);
    }
    for (const protoId of activeProtoIds) {
      const proto = nodePrototypesMap.get(protoId);
      if (!proto) continue;
      // A user-uploaded image lives in the main store and wins outright; the
      // cache is not involved, so leave whatever it holds alone.
      if (proto.thumbnailSrc) continue;

      const thumbUrl = proto.semanticMetadata?.wikipediaThumbnail;
      const cached = cache.getImage(protoId);

      if (thumbUrl && !cached) {
        const ratio = proto.semanticMetadata.imageAspectRatio || 1;
        queueThumbnailFetch(protoId, thumbUrl, ratio, proto.name || '');
      } else if (!thumbUrl && cached) {
        // The graph no longer references an image, but the canvas renders
        // whatever the cache holds — without this the image survives the redo.
        cancelThumbnailFetch(protoId);
      }
    }
  }, [nodePrototypesMap, activeGraphInstances]);

  useEffect(() => {
    if (!activeGraphId || !graphsMap || typeof graphsMap?.has !== 'function') return;
    if (graphsMap.has(activeGraphId)) return;
    if (!storeActions || typeof storeActions.createGraphWithId !== 'function') return;

    let fallbackName = 'New Thing';
    let fallbackDescription = '';
    let fallbackColor = NODE_DEFAULT_COLOR;

    if (nodePrototypesMap && typeof nodePrototypesMap.values === 'function') {
      for (const prototype of nodePrototypesMap.values()) {
        if (!prototype) continue;
        const definitionGraphIds = Array.isArray(prototype.definitionGraphIds)
          ? prototype.definitionGraphIds
          : Array.isArray(prototype.definitionGraphs)
            ? prototype.definitionGraphs
            : [];
        if (definitionGraphIds.includes(activeGraphId)) {
          if (prototype.name) {
            fallbackName = prototype.name;
          }
          if (prototype.description) {
            fallbackDescription = prototype.description;
          }
          if (prototype.color) {
            if (typeof prototype.color === 'string') {
              fallbackColor = prototype.color;
            } else if (typeof prototype.color === 'object') {
              if (typeof prototype.color.hex === 'string' && prototype.color.hex.trim()) {
                fallbackColor = prototype.color.hex;
              } else if (typeof prototype.color.toString === 'function') {
                const colorString = prototype.color.toString();
                if (typeof colorString === 'string' && colorString.trim()) {
                  fallbackColor = colorString;
                }
              }
            }
          }
          break;
        }
      }
    }

    try {
      storeActions.createGraphWithId(activeGraphId, {
        name: fallbackName,
        description: fallbackDescription,
        color: fallbackColor,
      });
    } catch (error) {
      console.warn('[NodeCanvas] Failed to auto-create graph canvas for', activeGraphId, error);
    }
  }, [activeGraphId, graphsMap, nodePrototypesMap, storeActions]);

  return { hydratedNodes };
}
