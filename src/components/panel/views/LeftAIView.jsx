import React from 'react';
import { Bot, Key, Settings, RotateCcw, Send, User, Square, Copy, Trash2, Brain, Wrench } from 'lucide-react';
import APIKeySetup from '../../../ai/components/APIKeySetup.jsx';
import mcpClient from '../../../services/mcpClient.js';
import apiKeyManager from '../../../services/apiKeyManager.js';
import { bridgeFetch, bridgeEventSource } from '../../../services/bridgeConfig.js';
import StandardDivider from '../../StandardDivider.jsx';
import { HEADER_HEIGHT } from '../../../constants.js';
import ToolCallCard from '../../ToolCallCard.jsx';
import { DRUID_SYSTEM_PROMPT } from '../../../services/agent/DruidPrompt.js';
import useGraphStore from '../../../store/graphStore.jsx';
import DruidInstance from '../../../services/DruidInstance.js';
import { searchWikipedia, getWikipediaPage, getWikipediaImages } from '../SharedPanelContent.jsx';
import { normalizeLabel, calculateTextSimilarity } from '../../../services/entityMatching.js';
import fullBodySvg from '../../../assets/svg/wizard/full_body.svg';
import headSvg from '../../../assets/svg/wizard/head.svg';

/**
 * Calculate Wikipedia confidence score for auto-enrichment
 * Returns 0.0 to 1.0, with 0.90+ indicating "dead match" quality
 */
function calculateWikipediaConfidence(nodeName, wikipediaResult) {
  let confidence = 0;

  // FACTOR 1: Result type (40 points)
  // Only accept direct Wikipedia page hits, reject disambiguation
  if (wikipediaResult.type === 'direct') {
    confidence += 0.40;
  } else {
    return 0.0; // Automatic rejection for disambiguation or not found
  }

  // FACTOR 2: Label matching (50 points)
  // Exact match required for 0.90 total
  const norm1 = normalizeLabel(nodeName);
  const norm2 = normalizeLabel(wikipediaResult.page.title);

  if (norm1 === norm2) {
    confidence += 0.50; // Exact match → Total 0.90 ✓
  } else {
    // Fuzzy match using text similarity
    const similarity = calculateTextSimilarity(norm1, norm2);
    confidence += similarity * 0.50;
  }

  return confidence;
}

/**
 * Convert image URL to data URL
 */
async function urlToDataUrl(url) {
  const response = await fetch(url, { mode: 'cors' });
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Enrich a single node with Wikipedia data
 * Only applies data when confidence >= 0.90 (dead match)
 */
async function enrichNodeWithWikipedia(nodeName, graphId, options = {}) {
  const { timeout = 10000, minConfidence = 0.90 } = options;

  try {
    console.log(`[Auto-Enrich] Starting Wikipedia enrichment for "${nodeName}"`);

    // 1. Search Wikipedia (reuse existing function from SharedPanelContent)
    const searchResult = await searchWikipedia(nodeName);

    // 2. Calculate confidence - reject if not direct match
    if (searchResult?.type !== 'direct') {
      console.log(`[Auto-Enrich] Skipping "${nodeName}" - disambiguation or not found`);
      return null;
    }

    const confidence = calculateWikipediaConfidence(nodeName, searchResult);

    if (confidence < minConfidence) {
      console.log(`[Auto-Enrich] Skipping "${nodeName}" - low confidence (${confidence.toFixed(2)})`);
      return null;
    }

    console.log(`[Auto-Enrich] High confidence match for "${nodeName}" (${confidence.toFixed(2)})`);

    // 3. Wait a bit for node to be fully created in store
    await new Promise(resolve => setTimeout(resolve, 500));

    // 4. Find the node in the store by name
    const store = useGraphStore.getState();
    let targetNodeProtoId = null;

    for (const [protoId, proto] of store.nodePrototypes) {
      if (proto.name.toLowerCase().trim() === nodeName.toLowerCase().trim()) {
        targetNodeProtoId = protoId;
        break;
      }
    }

    if (!targetNodeProtoId) {
      console.warn(`[Auto-Enrich] Node "${nodeName}" not found in store`);
      return null;
    }

    const nodeProto = store.nodePrototypes.get(targetNodeProtoId);

    // 5. Preserve user content - skip if node already has MEANINGFUL description
    // (AI agents often set empty description, so check for length > 10)
    if (nodeProto.description && nodeProto.description.trim().length > 10) {
      console.log(`[Auto-Enrich] Skipping "${nodeName}" - already has meaningful description`);
      return null;
    }

    // 6. Apply Wikipedia data (same structure as manual pull)
    const updates = {
      description: searchResult.page.description,
      semanticMetadata: {
        ...nodeProto.semanticMetadata,
        wikipediaUrl: searchResult.page.url,
        wikipediaTitle: searchResult.page.title,
        wikipediaThumbnail: searchResult.page.thumbnail,
        wikipediaOriginalImage: searchResult.page.originalImage,
        wikipediaAdditionalImages: searchResult.page.additionalImages || [],
        wikipediaEnriched: true,
        wikipediaEnrichedAt: new Date().toISOString(),
        autoEnriched: true, // NEW FLAG - marks as AI-enriched
        autoEnrichConfidence: confidence
      }
    };

    // 7. Add Wikipedia link to externalLinks
    const currentLinks = nodeProto.externalLinks || [];
    if (!currentLinks.some(link => String(link).includes('wikipedia.org'))) {
      updates.externalLinks = [searchResult.page.url, ...currentLinks];
    }

    // 8. Set image if available (convert URL to data URL like manual pull does)
    const imgUrl = searchResult.page.originalImage || searchResult.page.thumbnail;
    if (imgUrl && !nodeProto.imageSrc) {
      try {
        console.log(`[Auto-Enrich] Setting image from Wikipedia: ${imgUrl}`);
        const dataUrl = await urlToDataUrl(imgUrl);

        // Calculate aspect ratio
        const img = new Image();
        const aspectRatio = await new Promise((resolve, reject) => {
          img.onload = () => {
            const ratio = (img.naturalHeight > 0 && img.naturalWidth > 0)
              ? (img.naturalHeight / img.naturalWidth)
              : 1;
            resolve(ratio || 1);
          };
          img.onerror = () => resolve(1); // Default to 1 on error
          img.src = dataUrl;
        });

        // Generate thumbnail (simplified - just use the data URL)
        // The full thumbnail generation requires importing utils which might create circular deps
        updates.imageSrc = dataUrl;
        updates.thumbnailSrc = dataUrl; // Simplified - using same URL
        updates.imageAspectRatio = aspectRatio;

        console.log(`[Auto-Enrich] Image set successfully with aspect ratio ${aspectRatio}`);
      } catch (imageError) {
        console.warn(`[Auto-Enrich] Failed to set image for "${nodeName}":`, imageError);
        // Continue with text-only enrichment
      }
    }

    // 9. Update node prototype
    store.updateNodePrototype(targetNodeProtoId, (draft) => {
      Object.assign(draft, updates);
    });

    console.log(`[Auto-Enrich] Successfully enriched "${nodeName}" from Wikipedia`);

    return {
      success: true,
      nodeName,
      confidence,
      wikipediaUrl: searchResult.page.url
    };

  } catch (error) {
    console.warn(`[Auto-Enrich] Failed to enrich "${nodeName}":`, error);
    return null; // Silent failure - never block node creation
  }
}

/**
 * Enrich multiple nodes in batch with rate limiting
 * Staggers requests by 200ms to avoid Wikipedia API rate limits
 */
async function enrichMultipleNodes(nodeNames, graphId) {
  console.log(`[Auto-Enrich] Batch enrichment for ${nodeNames.length} nodes`);

  // Stagger requests by 200ms to avoid rate limiting
  const enrichmentPromises = nodeNames.map((nodeName, index) =>
    new Promise(resolve => setTimeout(() =>
      resolve(enrichNodeWithWikipedia(nodeName, graphId))
      , index * 200))
  );

  // Use allSettled to prevent one failure from blocking others
  const results = await Promise.allSettled(enrichmentPromises);

  const successful = results.filter(r =>
    r.status === 'fulfilled' && r.value?.success
  ).length;

  console.log(`[Auto-Enrich] Enriched ${successful}/${nodeNames.length} nodes`);

  return results;
}

/**
 * Apply wizard tool results to the store
 * This bridges the gap between server-side tool execution and client-side store
 */
function applyToolResultToStore(toolName, result) {
  console.log('[Wizard] applyToolResultToStore called:', toolName, 'action:', result?.action, 'hasSpec:', !!result?.spec);
  if (!result || result.error) {
    console.warn('[Wizard] applyToolResultToStore: skipping — no result or error:', result?.error);
    return;
  }
  const store = useGraphStore.getState();

  // Handle createGraph (empty graph)
  if (result.action === 'createGraph') {
    console.log('[Wizard] Applying createGraph to store:', result.graphName);
    store.createNewGraph({
      id: result.graphId,
      name: result.graphName,
      description: result.description || ''
    });
    console.log('[Wizard] Successfully created empty graph:', result.graphId);
    return;
  }

  // Handle createNode
  if (result.action === 'createNode') {
    console.log('[Wizard] Applying createNode to store:', result.name);
    const graphId = result.graphId || store.activeGraphId;
    if (!graphId) {
      console.error('[Wizard] createNode: No active graph ID');
      return;
    }
    store.applyBulkGraphUpdates(graphId, {
      nodes: [{
        name: result.name,
        color: result.color || '#5B6CFF',
        description: result.description || '',
        x: Math.random() * 600 + 200,
        y: Math.random() * 500 + 200
      }]
    });
    console.log('[Wizard] Successfully created node:', result.name);

    // NEW: Launch Wikipedia enrichment asynchronously (only if no description provided)
    if (!result.description || result.description.trim() === '') {
      enrichNodeWithWikipedia(result.name, graphId).catch(err => {
        console.warn('[Auto-Enrich] Wikipedia enrichment failed:', err);
      });
    }

    return;
  }

  // Handle updateNode — resolve by name from actual store (server IDs are synthetic)
  if (result.action === 'updateNode') {
    const lookupName = (result.originalName || '').toLowerCase().trim();
    console.log('[Wizard] Applying updateNode to store, looking up:', lookupName);
    if (!lookupName || !result.updates) {
      console.error('[Wizard] updateNode: Missing originalName or updates');
      return;
    }
    // Find the real prototype by name in the store
    let realProtoId = null;
    for (const [protoId, proto] of store.nodePrototypes) {
      if ((proto.name || '').toLowerCase().trim() === lookupName) {
        realProtoId = protoId;
        break;
      }
    }
    if (!realProtoId) {
      console.error('[Wizard] updateNode: Could not find prototype for name:', lookupName);
      return;
    }
    store.updateNodePrototype(realProtoId, (prototype) => {
      if (result.updates.name !== undefined) prototype.name = result.updates.name;
      if (result.updates.color !== undefined) prototype.color = result.updates.color;
      if (result.updates.description !== undefined) prototype.description = result.updates.description;
    });
    console.log('[Wizard] Successfully updated node:', realProtoId);
    return;
  }

  // Handle deleteNode — resolve by name from actual store (server IDs are synthetic)
  if (result.action === 'deleteNode') {
    const graphId = result.graphId || store.activeGraphId;
    const lookupName = (result.name || '').toLowerCase().trim();
    console.log('[Wizard] Applying deleteNode to store, looking up:', lookupName);
    if (!graphId || !lookupName) {
      console.error('[Wizard] deleteNode: Missing graphId or name');
      return;
    }
    const graph = store.graphs.get(graphId);
    if (!graph) {
      console.error('[Wizard] deleteNode: Graph not found:', graphId);
      return;
    }
    // Find the real instance by name
    let realInstanceId = null;
    for (const [instId, inst] of graph.instances) {
      const proto = store.nodePrototypes.get(inst.prototypeId);
      const nodeName = (proto?.name || '').toLowerCase().trim();
      if (nodeName === lookupName) {
        realInstanceId = instId;
        break;
      }
    }
    if (!realInstanceId) {
      console.error('[Wizard] deleteNode: Could not find instance for name:', lookupName);
      return;
    }
    store.removeNodeInstance(graphId, realInstanceId);
    console.log('[Wizard] Successfully deleted node:', lookupName, realInstanceId);
    return;
  }

  // Handle createEdge — use applyBulkGraphUpdates for name-based resolution
  if (result.action === 'createEdge') {
    const graphId = result.graphId || store.activeGraphId;
    console.log('[Wizard] Applying createEdge to store:', result.sourceName, '→', result.targetName);
    if (!graphId) {
      console.error('[Wizard] createEdge: No active graph ID');
      return;
    }
    store.applyBulkGraphUpdates(graphId, {
      nodes: [],
      edges: [{
        source: result.sourceName,
        target: result.targetName,
        type: result.type || 'relates to',
        directionality: 'unidirectional',
        definitionNode: result.type ? { name: result.type, color: '#708090' } : null
      }]
    });
    console.log('[Wizard] Successfully created edge:', result.sourceName, '→', result.targetName);
    return;
  }

  // Handle updateEdge — resolve by source/target names
  if (result.action === 'updateEdge') {
    const graphId = result.graphId || store.activeGraphId;
    console.log('[Wizard] Applying updateEdge to store:', result.sourceName, '→', result.targetName);
    if (!graphId) {
      console.error('[Wizard] updateEdge: No active graph ID');
      return;
    }
    const graph = store.graphs.get(graphId);
    if (!graph) return;

    let sourceInstId = null, targetInstId = null;
    const sourceNameLookup = (result.sourceName || '').toLowerCase().trim();
    const targetNameLookup = (result.targetName || '').toLowerCase().trim();

    for (const [instId, inst] of graph.instances) {
      const p = store.nodePrototypes.get(inst.prototypeId);
      const n = (p?.name || '').toLowerCase().trim();
      if (n === sourceNameLookup) sourceInstId = instId;
      if (n === targetNameLookup) targetInstId = instId;
    }

    if (!sourceInstId || !targetInstId) {
      console.error('[Wizard] updateEdge: Could not resolve source/target instances:', result.sourceName, result.targetName);
      return;
    }

    let realEdgeId = null;
    let actualEdge = null;
    for (const edgeId of graph.edgeIds) {
      const edge = store.edges.get(edgeId);
      if (!edge) continue;
      if ((edge.sourceId === sourceInstId && edge.destinationId === targetInstId) ||
        (edge.sourceId === targetInstId && edge.destinationId === sourceInstId)) {
        realEdgeId = edgeId;
        actualEdge = edge;
        break;
      }
    }

    if (!realEdgeId) {
      console.error('[Wizard] updateEdge: Edge not found between instances:', sourceInstId, targetInstId);
      return;
    }

    let protoIdToLink = null;
    if (result.updates.type) {
      const typeLookup = result.updates.type.toLowerCase().trim();
      for (const [id, proto] of store.nodePrototypes) {
        if ((proto.name || '').toLowerCase().trim() === typeLookup) {
          protoIdToLink = id;
          break;
        }
      }

      if (!protoIdToLink) {
        protoIdToLink = `proto-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        store.addNodePrototype({
          id: protoIdToLink,
          name: result.updates.type,
          color: '#708090',
          description: '',
          typeNodeId: null,
          definitionGraphIds: []
        });
        console.log('[Wizard] updateEdge: Created new type prototype for:', result.updates.type);
      }
    }

    store.updateEdge(realEdgeId, (draft) => {
      if (result.updates.directionality) {
        // Redstring directionality translates to arrowsToward array
        if (result.updates.directionality === 'bidirectional') {
          draft.directionality.arrowsToward = new Set([actualEdge.sourceId, actualEdge.destinationId]);
        } else if (result.updates.directionality === 'unidirectional') {
          // Pointing to target
          draft.directionality.arrowsToward = new Set([actualEdge.sourceId === sourceInstId ? actualEdge.destinationId : actualEdge.sourceId]);
        } else if (result.updates.directionality === 'reverse') {
          // Pointing to source
          draft.directionality.arrowsToward = new Set([actualEdge.sourceId === sourceInstId ? actualEdge.sourceId : actualEdge.destinationId]);
        } else if (result.updates.directionality === 'none') {
          draft.directionality.arrowsToward = new Set();
        }
      }
      if (protoIdToLink) {
        draft.definitionNodeIds = [protoIdToLink];
      }
    });
    console.log('[Wizard] Successfully updated edge:', realEdgeId);
    return;
  }

  // Handle deleteEdge — resolve by edge ID or by source/target names
  if (result.action === 'deleteEdge') {
    const graphId = result.graphId || store.activeGraphId;
    console.log('[Wizard] Applying deleteEdge to store');
    if (!graphId) {
      console.error('[Wizard] deleteEdge: No active graph ID');
      return;
    }
    // If we have an edge ID, delete directly
    if (result.edgeId) {
      store.removeEdge(result.edgeId);
      console.log('[Wizard] Successfully deleted edge by ID:', result.edgeId);
      return;
    }
    // Otherwise try to find edge by source/target names
    if (result.sourceName && result.targetName) {
      const graph = store.graphs.get(graphId);
      if (!graph) return;
      const srcLower = result.sourceName.toLowerCase().trim();
      const tgtLower = result.targetName.toLowerCase().trim();
      // Build name→instanceId map
      const nameToInstId = new Map();
      for (const [instId, inst] of graph.instances) {
        const proto = store.nodePrototypes.get(inst.prototypeId);
        const name = (proto?.name || '').toLowerCase().trim();
        if (name) nameToInstId.set(name, instId);
      }
      const srcInstId = nameToInstId.get(srcLower);
      const tgtInstId = nameToInstId.get(tgtLower);
      if (srcInstId && tgtInstId) {
        for (const edgeId of (graph.edgeIds || [])) {
          const edge = store.edges.get(edgeId);
          if (edge && (
            (edge.sourceId === srcInstId && edge.destinationId === tgtInstId) ||
            (edge.sourceId === tgtInstId && edge.destinationId === srcInstId)
          )) {
            store.removeEdge(edgeId);
            console.log('[Wizard] Successfully deleted edge by names:', result.sourceName, '→', result.targetName);
            return;
          }
        }
      }
      console.warn('[Wizard] deleteEdge: Could not find edge between', result.sourceName, 'and', result.targetName);
    }
    return;
  }

  // Handle createGroup
  if (result.action === 'createGroup') {
    const graphId = result.graphId || store.activeGraphId;
    console.log('[Wizard] Applying createGroup to store:', result.name);
    if (!graphId) {
      console.error('[Wizard] createGroup: No active graph ID');
      return;
    }
    // Resolve member names to real instance IDs from the store
    const graph = store.graphs.get(graphId);
    const memberInstanceIds = [];
    if (graph && result.memberNames) {
      for (const memberName of result.memberNames) {
        const nameLower = memberName.toLowerCase().trim();
        for (const [instId, inst] of graph.instances) {
          const proto = store.nodePrototypes.get(inst.prototypeId);
          if ((proto?.name || '').toLowerCase().trim() === nameLower) {
            memberInstanceIds.push(instId);
            break;
          }
        }
      }
    }
    store.createGroup(graphId, {
      name: result.name,
      color: result.color || '#8B0000',
      memberInstanceIds
    });
    console.log('[Wizard] Successfully created group:', result.name, '| members:', memberInstanceIds.length);
    return;
  }

  // Handle deleteGroup — resolve by name from actual store
  if (result.action === 'deleteGroup') {
    const graphId = result.graphId || store.activeGraphId;
    console.log('[Wizard] Applying deleteGroup to store:', result.groupName || result.groupId);
    if (!graphId) {
      console.error('[Wizard] deleteGroup: No active graph ID');
      return;
    }
    let realGroupId = result.groupId;
    if (!realGroupId && result.groupName) {
      const graph = store.graphs.get(graphId);
      if (graph?.groups) {
        const nameLower = result.groupName.toLowerCase().trim();
        for (const [gId, group] of graph.groups) {
          if ((group.name || '').toLowerCase().trim() === nameLower) {
            realGroupId = gId;
            break;
          }
        }
      }
    }
    if (realGroupId) {
      store.deleteGroup(graphId, realGroupId);
      console.log('[Wizard] Successfully deleted group:', realGroupId);
    } else {
      console.error('[Wizard] deleteGroup: Could not find group:', result.groupName);
    }
    return;
  }

  // Handle updateGroup — resolve by name from actual store
  if (result.action === 'updateGroup') {
    const graphId = result.graphId || store.activeGraphId;
    console.log('[Wizard] Applying updateGroup to store:', result.groupName || result.groupId);
    if (!graphId) {
      console.error('[Wizard] updateGroup: No active graph ID');
      return;
    }
    let realGroupId = result.groupId;
    if (!realGroupId && result.groupName) {
      const graph = store.graphs.get(graphId);
      if (graph?.groups) {
        const nameLower = result.groupName.toLowerCase().trim();
        for (const [gId, group] of graph.groups) {
          if ((group.name || '').toLowerCase().trim() === nameLower) {
            realGroupId = gId;
            break;
          }
        }
      }
    }
    if (realGroupId && result.updates) {
      store.updateGroup(graphId, realGroupId, (group) => {
        if (result.updates.name !== undefined) group.name = result.updates.name;
        if (result.updates.color !== undefined) group.color = result.updates.color;
        // Add/remove members by name
        if (result.updates.addMembers) {
          const graph = store.graphs.get(graphId);
          for (const memberName of result.updates.addMembers) {
            const nameLower = memberName.toLowerCase().trim();
            for (const [instId, inst] of graph.instances) {
              const proto = store.nodePrototypes.get(inst.prototypeId);
              if ((proto?.name || '').toLowerCase().trim() === nameLower) {
                if (!group.memberInstanceIds.includes(instId)) {
                  group.memberInstanceIds.push(instId);
                }
                break;
              }
            }
          }
        }
        if (result.updates.removeMembers) {
          const graph = store.graphs.get(graphId);
          const idsToRemove = new Set();
          for (const memberName of result.updates.removeMembers) {
            const nameLower = memberName.toLowerCase().trim();
            for (const [instId, inst] of graph.instances) {
              const proto = store.nodePrototypes.get(inst.prototypeId);
              if ((proto?.name || '').toLowerCase().trim() === nameLower) {
                idsToRemove.add(instId);
                break;
              }
            }
          }
          group.memberInstanceIds = group.memberInstanceIds.filter(id => !idsToRemove.has(id));
        }
      });
      console.log('[Wizard] Successfully updated group:', realGroupId);
    } else {
      console.error('[Wizard] updateGroup: Could not find group:', result.groupName);
    }
    return;
  }

  // Handle convertToThingGroup — resolve group by name then call store method
  if (result.action === 'convertToThingGroup') {
    const graphId = result.graphId || store.activeGraphId;
    console.log('[Wizard] Applying convertToThingGroup to store:', result.groupName || result.groupId);
    if (!graphId) {
      console.error('[Wizard] convertToThingGroup: No active graph ID');
      return;
    }
    let realGroupId = result.groupId;
    if (!realGroupId && result.groupName) {
      const graph = store.graphs.get(graphId);
      if (graph?.groups) {
        const nameLower = result.groupName.toLowerCase().trim();
        for (const [gId, group] of graph.groups) {
          if ((group.name || '').toLowerCase().trim() === nameLower) {
            realGroupId = gId;
            break;
          }
        }
      }
    }
    if (realGroupId) {
      store.convertGroupToNodeGroup(
        graphId,
        realGroupId,
        null,
        result.createNewThing !== false,
        result.thingName || 'Thing Group',
        result.newThingColor || '#8B0000'
      );
      console.log('[Wizard] Successfully converted group to thing-group:', realGroupId);
    } else {
      console.error('[Wizard] convertToThingGroup: Could not find group:', result.groupName);
    }
    return;
  }

  // Handle combineThingGroup — resolve group by name then call store method
  if (result.action === 'combineThingGroup') {
    const graphId = result.graphId || store.activeGraphId;
    console.log('[Wizard] Applying combineThingGroup to store:', result.groupName || result.groupId);
    if (!graphId) {
      console.error('[Wizard] combineThingGroup: No active graph ID');
      return;
    }
    let realGroupId = result.groupId;
    if (!realGroupId && result.groupName) {
      const graph = store.graphs.get(graphId);
      if (graph?.groups) {
        const nameLower = result.groupName.toLowerCase().trim();
        for (const [gId, group] of graph.groups) {
          if ((group.name || '').toLowerCase().trim() === nameLower) {
            realGroupId = gId;
            break;
          }
        }
      }
    }
    if (realGroupId) {
      store.combineNodeGroup(graphId, realGroupId);
      console.log('[Wizard] Successfully combined thing-group:', realGroupId);
    } else {
      console.error('[Wizard] combineThingGroup: Could not find group:', result.groupName);
    }
    return;
  }

  // Handle createPopulatedGraph
  if (result.action === 'createPopulatedGraph' && result.spec) {
    console.log('[Wizard] Applying createPopulatedGraph to store:', result.graphName);
    console.log('[Wizard] Nodes count:', result.spec.nodes?.length || 0);
    console.log('[Wizard] Edges count:', result.spec.edges?.length || 0);
    console.log('[Wizard] Groups count:', result.spec.groups?.length || 0);

    // 1. Create the graph first
    const graphId = store.createNewGraph({
      id: result.graphId,
      name: result.graphName,
      description: result.description || ''
    });

    // 2. Prepare bulk updates - use unique IDs for each node
    const bulkData = {
      nodes: result.spec.nodes.map((n, idx) => ({
        name: n.name,
        color: n.color,
        description: n.description,
        prototypeId: `proto-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 8)}`,
        instanceId: `inst-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 8)}`,
        x: Math.random() * 600 + 200,
        y: Math.random() * 500 + 200
      })),
      edges: (result.spec.edges || []).map(e => ({
        source: e.source,
        target: e.target,
        type: e.type || 'relates to',
        directionality: e.directionality || 'unidirectional',
        definitionNode: e.definitionNode || null
      })),
      groups: result.spec.groups || []
    };

    // 3. Apply bulk updates in one transaction
    store.applyBulkGraphUpdates(graphId, bulkData);

    console.log('[Wizard] Successfully populated graph:', graphId);

    // 4. Trigger auto-layout so nodes get properly positioned
    //    (same as clicking Edit > Auto-Layout from the menu)
    //    Use a delay to ensure the graph is fully rendered with node dimensions
    setTimeout(() => {
      if (typeof window !== 'undefined') {
        console.log('[Wizard] Triggering auto-layout for new graph:', graphId);
        window.dispatchEvent(new CustomEvent('rs-trigger-auto-layout', {
          detail: { graphId }
        }));
      }
    }, 600);

    // 5. NEW: Launch batch Wikipedia enrichment asynchronously
    // Wait 1s for nodes to be fully created in store
    const nodeNames = result.spec.nodes.map(n => n.name);
    setTimeout(() => {
      enrichMultipleNodes(nodeNames, graphId).catch(err => {
        console.warn('[Auto-Enrich] Batch enrichment failed:', err);
      });
    }, 1000);
  } else if (result.action === 'expandGraph' && result.spec) {
    // Handle expandGraph — apply nodes and edges to the ACTIVE graph
    console.log('[Wizard] Applying expandGraph to active graph:', result.graphId);
    console.log('[Wizard] New nodes:', result.spec.nodes?.length || 0);
    console.log('[Wizard] New edges:', result.spec.edges?.length || 0);

    const activeGraphId = result.graphId || store.activeGraphId;
    if (!activeGraphId) {
      console.error('[Wizard] expandGraph: No active graph ID');
      return;
    }

    // Prepare bulk updates with unique IDs for each NEW node
    const bulkData = {
      nodes: result.spec.nodes.map((n, idx) => ({
        name: n.name,
        color: n.color,
        description: n.description,
        prototypeId: `proto-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 8)}`,
        instanceId: `inst-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 8)}`,
        x: Math.random() * 600 + 200,
        y: Math.random() * 500 + 200
      })),
      edges: (result.spec.edges || []).map(e => ({
        source: e.source,
        target: e.target,
        type: e.type || 'relates to',
        directionality: e.directionality || 'unidirectional',
        definitionNode: e.definitionNode || null
      })),
      groups: result.spec.groups || []
    };

    // Apply bulk updates to the ACTIVE graph (not creating a new one)
    store.applyBulkGraphUpdates(activeGraphId, bulkData);

    console.log('[Wizard] Successfully expanded graph:', activeGraphId);

    // Trigger auto-layout so new nodes get properly positioned
    setTimeout(() => {
      if (typeof window !== 'undefined') {
        console.log('[Wizard] Triggering auto-layout for expanded graph:', activeGraphId);
        window.dispatchEvent(new CustomEvent('rs-trigger-auto-layout', {
          detail: { graphId: activeGraphId }
        }));
      }
    }, 600);

    // NEW: Launch batch Wikipedia enrichment asynchronously
    // Wait 1s for nodes to be fully created in store
    const nodeNames = result.spec.nodes.map(n => n.name);
    setTimeout(() => {
      enrichMultipleNodes(nodeNames, activeGraphId).catch(err => {
        console.warn('[Auto-Enrich] Batch enrichment failed:', err);
      });
    }, 1000);
  } else if (result.action === 'selectNode' && result.found && result.node) {
    // Dispatch event for NodeCanvas to select and focus on the node
    console.log(`[Wizard] Selecting node: "${result.node.name}" (${result.node.instanceId})`);
    setTimeout(() => {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('rs-select-node', {
          detail: {
            instanceId: result.node.instanceId,
            prototypeId: result.node.prototypeId,
            name: result.node.name
          }
        }));
      }
    }, 100);
  } else if (result.goalId || toolName === 'updateGroup' || toolName === 'deleteGroup') {
    // Other mutating tools that go through the goal queue
    // We trigger a re-fetch of the graph state to ensure the UI is in sync
    console.log(`[Wizard] Applying ${toolName} to store, triggering refresh.`);

    // Slight delay to allow backend to finish committing
    setTimeout(() => {
      if (typeof window !== 'undefined' && window.redstringStoreActions && window.redstringStoreActions._triggerGraphRefresh) {
        window.redstringStoreActions._triggerGraphRefresh();
      }
    }, 500);
  }
}

// Internal AI Collaboration View component (migrated from src/ai/AICollaborationPanel.jsx)
const LeftAIView = ({ compact = false,
  activeGraphId,
  graphsMap,
  edgesMap,
  nodePrototypesMap
}) => {
  const [isConnected, setIsConnected] = React.useState(false);
  const [messages, setMessages] = React.useState([]);
  const [currentInput, setCurrentInput] = React.useState('');
  const [isProcessing, setIsProcessing] = React.useState(false);
  const [showAdvanced, setShowAdvanced] = React.useState(false);
  const [showToolsDropdown, setShowToolsDropdown] = React.useState(false);
  const [wizardTools, setWizardTools] = React.useState([]);
  const [selectedTestTool, setSelectedTestTool] = React.useState(null);
  const [testToolArgs, setTestToolArgs] = React.useState('');
  const [showAPIKeySetup, setShowAPIKeySetup] = React.useState(false);
  const [hasAPIKey, setHasAPIKey] = React.useState(false);
  const [apiKeyInfo, setApiKeyInfo] = React.useState(null);
  const [viewMode, setViewMode] = React.useState('wizard'); // 'wizard', 'chat', 'druid'
  const [currentAgentRequest, setCurrentAgentRequest] = React.useState(null);
  const [wizardStage, setWizardStage] = React.useState(null); // Track current wizard stage
  const [druidInstance, setDruidInstance] = React.useState(null); // Druid cognitive state manager
  const messagesEndRef = React.useRef(null);
  const inputRef = React.useRef(null);

  const STORAGE_KEY = 'rs.aiChat.messages.v1';
  const RESET_TS_KEY = 'rs.aiChat.resetTs';

  // Use the existing subscriptions from the main section to prevent Panel jitter
  // activeGraphId and graphsMap are already available from the main subscriptions

  React.useEffect(() => {
    try {
      if (mcpClient && mcpClient.isConnected) setIsConnected(true);
    } catch { }
    let resetTs = 0;
    try {
      const cached = localStorage.getItem(STORAGE_KEY);
      const rt = localStorage.getItem(RESET_TS_KEY);
      resetTs = rt ? Number(rt) || 0 : 0;
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed)) setMessages(parsed);
      }
    } catch { }
    (async () => {
      try {
        const res = await bridgeFetch('/api/bridge/telemetry');
        if (!res.ok) return;
        const data = await res.json();
        const chat = Array.isArray(data?.chat) ? data.chat : [];
        if (chat.length === 0) return;
        const hydrated = chat
          .filter((c) => !resetTs || (typeof c.ts === 'number' && c.ts >= resetTs))
          .map((c) => ({
            id: `${c.ts || Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
            sender: c.role === 'user' ? 'user' : c.role === 'ai' ? 'ai' : 'system',
            content: c.text || '',
            timestamp: new Date(c.ts || Date.now()).toISOString(),
            metadata: {}
          }));
        setMessages((prev) => (prev.length === 0 ? hydrated : prev));
      } catch (error) {
        console.warn('[AI Collaboration] Failed to hydrate bridge telemetry:', error);
      }
    })();

    // CRITICAL: Subscribe to SSE for real-time chat updates (e.g., executor errors)
    let eventSource;
    try {
      eventSource = bridgeEventSource('/events/stream');

      eventSource.addEventListener('chat', (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('[AI Collaboration] Received chat event:', data);

          // Add message to chat immediately (real-time update)
          setMessages(prev => {
            // Check if message already exists (avoid duplicates)
            const alreadyExists = prev.some(m =>
              Math.abs(new Date(m.timestamp).getTime() - data.ts) < 1000 && m.content === data.text
            );

            if (alreadyExists) return prev;

            // Add new message
            const newMessage = {
              id: `${data.ts || Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
              sender: data.role === 'user' ? 'user' : data.role === 'ai' ? 'ai' : 'system',
              content: data.text || '',
              timestamp: new Date(data.ts || Date.now()).toISOString(),
              metadata: data,
              toolCalls: []
            };

            return [...prev, newMessage];
          });
        } catch (err) {
          console.warn('[AI Collaboration] Failed to process chat event:', err);
        }
      });

      eventSource.onerror = () => {
        // Silently handle SSE errors - server may not be available
        // Connection errors are expected when bridge server isn't running
      };
    } catch (err) {
      console.warn('[AI Collaboration] Failed to establish SSE:', err);
    }

    return () => {
      if (eventSource) {
        try {
          eventSource.close();
        } catch (err) {
          console.warn('[AI Collaboration] Failed to close SSE:', err);
        }
      }
    };
  }, []);

  React.useEffect(() => {
    // Fetch wizard tools on load
    const fetchWizardTools = async () => {
      try {
        const res = await bridgeFetch('/api/wizard/tools');
        if (res.ok) {
          const data = await res.json();
          if (data.tools) setWizardTools(data.tools);
        }
      } catch (err) {
        console.warn('Failed to fetch wizard tools:', err);
      }
    };
    fetchWizardTools();
  }, []);

  React.useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(messages)); } catch { }
    // Auto-scroll to bottom when messages update
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  React.useEffect(() => { checkAPIKey(); }, []);
  const checkAPIKey = async () => {
    try {
      const hasKey = await apiKeyManager.hasAPIKey();
      const keyInfo = await apiKeyManager.getAPIKeyInfo();
      setHasAPIKey(hasKey);
      setApiKeyInfo(keyInfo);
    } catch (error) { console.error('Failed to check API key:', error); }
  };

  // Initialize DruidInstance when switching to Druid mode
  React.useEffect(() => {
    if (viewMode === 'druid' && !druidInstance) {
      console.log('[Druid] Initializing DruidInstance...');
      const instance = new DruidInstance(useGraphStore);

      // Ensure workspace is ready
      instance.ensureWorkspace().then(() => {
        console.log('[Druid] Workspace initialized');
        setDruidInstance(instance);
      }).catch(err => {
        console.error('[Druid] Failed to initialize workspace:', err);
      });
    }
  }, [viewMode, druidInstance]);

  const addMessage = (sender, content, metadata = {}) => {
    // Check for duplicates before adding
    setMessages(prev => {
      // Check if this exact message already exists (same sender, content, and recent timestamp)
      const isDuplicate = prev.some(m =>
        m.sender === sender &&
        m.content === content &&
        Math.abs(new Date(m.timestamp).getTime() - Date.now()) < 2000 // Within 2 seconds
      );
      if (isDuplicate) {
        console.log('[AI Collaboration] Skipping duplicate message:', content.substring(0, 50));
        return prev;
      }

      const message = {
        id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        sender,
        content,
        timestamp: new Date().toISOString(),
        metadata,
        toolCalls: (metadata.toolCalls || []).map(tc => ({ ...tc, expanded: false }))
      };
      return [...prev, message];
    });
  };

  // Simple markdown renderer for chat messages (supports *, **, ***)
  const renderMarkdown = (text) => {
    if (!text) return text;

    const escapeHtml = (str) =>
      str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    // Escape any HTML first to avoid injection when we swap in tags below
    let html = escapeHtml(text);

    // ***bold+italic***
    html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    // **bold**
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // *italic*
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

    // Replace newlines with <br> for layout consistency
    html = html.replace(/\n/g, '<br>');

    return html;
  };

  const upsertToolCall = (toolUpdate) => {
    setMessages(prev => {
      const updated = [...prev];
      let idx = updated.length - 1;
      while (idx >= 0 && updated[idx].sender !== 'ai') idx--;
      if (idx < 0) {
        updated.push({ id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`, sender: 'ai', content: '', timestamp: new Date().toISOString(), toolCalls: [] });
        idx = updated.length - 1;
      }
      const msg = { ...updated[idx] };
      const calls = Array.isArray(msg.toolCalls) ? [...msg.toolCalls] : [];
      const matchIndex = calls.findIndex(c => (toolUpdate.id && c.id === toolUpdate.id)
        || (toolUpdate.cid && c.cid === toolUpdate.cid && c.name === toolUpdate.name)
        || (!toolUpdate.cid && c.name === toolUpdate.name));
      if (matchIndex >= 0) {
        calls[matchIndex] = { ...calls[matchIndex], ...toolUpdate };
      } else {
        calls.push({ expanded: false, status: toolUpdate.status || 'running', ...toolUpdate });
      }
      msg.toolCalls = calls;
      updated[idx] = msg;
      return updated;
    });
  };

  React.useEffect(() => {
    const handler = (e) => {
      const items = Array.isArray(e.detail) ? e.detail : [];
      items.forEach((t) => {
        // Handle wizard stage updates
        if (t.type === 'wizard_stage') {
          if (t.status === 'start') {
            setWizardStage({ stage: t.stage, toolName: t.data?.toolName });
          } else if (t.status === 'success' || t.status === 'error') {
            setWizardStage(null); // Clear stage when complete
          }
          return;
        }
        if (t.type === 'tool_call') {
          const status = t.status || (t.leased ? 'running' : 'running');
          upsertToolCall({
            id: t.id,
            name: t.name || 'tool',
            status,
            args: t.args,
            result: t.result,
            error: t.error,
            executionTime: t.executionTime,
            timestamp: t.ts,
            cid: t.cid
          });
          return;
        }
        if (t.type === 'agent_queued') {
          if (messages.length > 0) upsertToolCall({ name: 'agent', status: 'queued', args: { queued: t.queued, graphId: t.graphId }, cid: t.cid });
          return;
        }
        if (t.type === 'info') {
          upsertToolCall({ name: t.name || 'info', status: 'completed', result: t.message, cid: t.cid });
          return;
        }
        if (t.type === 'agent_answer') {
          const finalText = (t.text || '').trim();
          setMessages(prev => {
            const isDefault = /\bwhat will we (make|build) today\?/i.test(finalText);
            if (prev.length === 0 && isDefault) return prev;
            const updated = [...prev];
            let idx = updated.length - 1;
            while (idx >= 0 && updated[idx].sender !== 'ai') idx--;
            if (idx >= 0) {
              const currentContent = updated[idx].content || '';
              // Avoid duplicating if the text is already at the end
              if (!currentContent.endsWith(finalText)) {
                updated[idx] = {
                  ...updated[idx],
                  content: currentContent ? `${currentContent}\n${finalText}` : finalText
                };
              }
              return updated;
            }
            if (updated.length === 0 && isDefault) return updated;
            return [...updated, { id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`, sender: 'ai', content: finalText, timestamp: new Date().toISOString(), toolCalls: [] }];
          });
          return;
        }
      });
    };
    window.addEventListener('rs-telemetry', handler);
    return () => window.removeEventListener('rs-telemetry', handler);
  }, []);

  React.useEffect(() => {
    if (hasAPIKey && !isConnected && !isProcessing) {
      if (mcpClient && mcpClient.isConnected) { setIsConnected(true); return; }
      initializeConnection();
    }
  }, [hasAPIKey]);

  const initializeConnection = async () => {
    try {
      setIsProcessing(true);
      await mcpClient.connect();
      setIsConnected(true);
    } catch (error) {
      console.error('[AI Collaboration] Connection failed:', error);
      setIsConnected(false);
      addMessage('system', `Connection failed: ${error.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // Bridge connection refresh disabled
  const refreshBridgeConnection = async () => {
    try {
      setIsProcessing(true);
      const [healthRes, stateRes] = await Promise.all([
        bridgeFetch('/api/bridge/health').catch((error) => { throw new Error(error.message || 'Bridge health request failed'); }),
        bridgeFetch('/api/bridge/state').catch(() => null)
      ]);

      if (!healthRes || !healthRes.ok) {
        throw new Error('Bridge daemon is unreachable. Make sure it is running on :3001.');
      }
      const health = await healthRes.json();
      let summary = `Bridge daemon online (${health.source || 'bridge-daemon'})`;

      if (stateRes && stateRes.ok) {
        const bridgeState = await stateRes.json();
        const graphCount = Array.isArray(bridgeState?.graphs) ? bridgeState.graphs.length : 0;
        const pending = Array.isArray(bridgeState?.pendingActions) ? bridgeState.pendingActions.length : 0;
        summary += ` • Graphs mirrored: ${graphCount}${pending ? ` • Pending actions: ${pending}` : ''}`;
      }

      await mcpClient.connect();
      setIsConnected(true);
      addMessage('system', `${summary}\nConnection refreshed.`);
    } catch (e) {
      console.error('[AI Collaboration] Bridge refresh failed:', e);
      setIsConnected(false);
      addMessage('system', `Bridge refresh failed: ${e.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSendMessage = async () => {
    if (!currentInput.trim() || isProcessing) return;

    // Trigger active mode for faster polling
    if (window.redstringStoreActions && window.redstringStoreActions._markActive) {
      window.redstringStoreActions._markActive();
    }
    const userMessage = currentInput.trim();



    // Handle slash commands
    if (userMessage.startsWith('/')) {
      const command = userMessage.slice(1).split(' ')[0].toLowerCase();
      const args = userMessage.slice(1).split(' ').slice(1);

      if (command === 'test') {
        addMessage('user', userMessage);
        setCurrentInput('');
        setIsProcessing(true);

        try {
          // Determine test mode from args
          const mode = args.includes('--auto-discover') ? 'auto' :
            args.includes('--dry-run') ? 'dry' :
              'full';

          const modeDesc = mode === 'auto' ? 'Auto-discovery mode (testing all 12 tools)' :
            mode === 'dry' ? 'Dry-run mode (connectivity check only)' :
              'Full test mode (intent detection tests)';

          addMessage('system', `🧪 Running wizard tests in ${modeDesc}...`);

          // Get API key to pass to test process
          const apiKey = await apiKeyManager.getAPIKey();
          if (!apiKey && mode !== 'dry') {
            addMessage('system', '⚠️ No API key configured. Running in dry-run mode (connectivity check only).');
          }

          // Trigger tests via bridge
          const response = await bridgeFetch('/api/bridge/run-tests', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(apiKey && { 'Authorization': `Bearer ${apiKey}` })
            },
            body: JSON.stringify({ mode })
          });

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }

          const result = await response.json();

          if (result.success) {
            addMessage('system', '✅ Tests started successfully!');
            addMessage('system', 'Watch this chat for results, or check your terminal for detailed output.');
          } else {
            addMessage('system', `⚠️ Tests started but returned: ${result.message || 'Unknown status'}`);
          }

        } catch (error) {
          addMessage('system', `❌ Failed to run tests: ${error.message}`);
          addMessage('system', 'Make sure the bridge daemon is running (npm run bridge)');
        } finally {
          setIsProcessing(false);
        }
        return;
      }



      // Unknown command
      addMessage('user', userMessage);
      addMessage('system', `Unknown command: /${command}\n\nAvailable commands:\n  /test [--dry-run|--auto-discover] - Run wizard tests`);
      setCurrentInput('');
      return;
    }

    // Normal message handling
    addMessage('user', userMessage);
    setCurrentInput('');
    setIsProcessing(true);

    // Druid Mode (Placeholder for full switch)
    if (viewMode === 'druid') {
      try {
        // Reuse the autonomous agent handler but with Druid prompt
        await handleAutonomousAgent(userMessage, 'druid');
      } catch (error) {
        console.error('Druid error:', error);
        addMessage('system', `Druid error: ${error.message}`);
      } finally {
        setIsProcessing(false);
      }
      return;
    }

    // Wizard / Chat Mode
    try {
      if (!hasAPIKey) {
        addMessage('system', 'No API key configured. Please set up your OpenRouter or Anthropic API key below to use the Wizard.');
        setShowAPIKeySetup(true);
        setIsProcessing(false);
        return;
      }
      if (!mcpClient.isConnected) { await initializeConnection(); if (!mcpClient.isConnected) { setIsProcessing(false); return; } }

      if (viewMode === 'wizard') {
        await handleAutonomousAgent(userMessage);
      } else {
        await handleQuestion(userMessage);
      }
    } catch (error) {
      console.error('[AI Collaboration] Error processing message:', error);
      addMessage('system', `Error: ${error.message}`);
    } finally {
      setIsProcessing(false);
      setCurrentAgentRequest(null);
    }
  };

  const handleStopAgent = () => {
    if (currentAgentRequest) {
      currentAgentRequest.abort();
      setCurrentAgentRequest(null);
      setIsProcessing(false);
      addMessage('system', '🛑 Agent execution stopped by user.');
    }
  };

  const getGraphInfo = () => {
    if (!activeGraphId || !graphsMap || typeof graphsMap.has !== 'function' || !graphsMap.has(activeGraphId)) {
      return { name: 'No active graph', nodeCount: 0, edgeCount: 0 };
    }
    const graph = graphsMap.get(activeGraphId);
    if (!graph) {
      return { name: 'No active graph', nodeCount: 0, edgeCount: 0 };
    }
    const nodeCount = graph.instances && typeof graph.instances.size === 'number' ? graph.instances.size : (graph.instances ? Object.keys(graph.instances).length : 0);
    const edgeCount = Array.isArray(graph.edgeIds) ? graph.edgeIds.length : 0;
    return {
      name: graph.name || 'Unnamed graph',
      nodeCount,
      edgeCount
    };
  };
  const graphInfo = getGraphInfo();
  const graphCount = graphsMap && typeof graphsMap.size === 'number' ? graphsMap.size : 0;

  const handleAutonomousAgent = async (question, persona = 'wizard') => {
    // Message ID for streaming updates - message will be created on first SSE event
    // Defined outside try/catch so it's available in error handler
    const streamingMessageId = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    try {
      const apiConfig = await apiKeyManager.getAPIKeyInfo();
      const apiKey = await apiKeyManager.getAPIKey();
      if (!apiKey) {
        addMessage('system', 'No API key configured. Please set up your OpenRouter or Anthropic API key below to use the Wizard.');
        setShowAPIKeySetup(true);
        return;
      }
      if (!apiConfig) {
        addMessage('system', 'API configuration not found. Please set up your API key below.');
        setShowAPIKeySetup(true);
        return;
      }
      const abortController = new AbortController();
      setCurrentAgentRequest(abortController);

      // Send recent conversation history for context memory
      const recentMessages = messages.slice(-10).map(msg => ({
        role: msg.sender === 'user' ? 'user' : msg.sender === 'ai' ? 'assistant' : 'system',
        content: msg.content
      }));

      // Build rich context with actual graph data (not just ID)
      const activeGraphData = activeGraphId && graphsMap && graphsMap.has(activeGraphId)
        ? graphsMap.get(activeGraphId)
        : null;

      // Extract nodes and edges for LLM context (token-limited to top 50 nodes)
      let graphStructure = null;
      if (activeGraphData) {
        const instances = activeGraphData.instances instanceof Map
          ? Array.from(activeGraphData.instances.values())
          : Array.isArray(activeGraphData.instances)
            ? activeGraphData.instances
            : Object.values(activeGraphData.instances || {});

        // Extract nodes and edges for LLM context
        // Adaptive token limit: Use a character budget instead of hard 50-node limit
        const CHAR_BUDGET = 15000; // Approx 3k-4k tokens
        let currentChars = 0;
        const nodeNames = [];
        let truncated = false;

        for (const inst of instances) {
          const name = inst.name || `Node ${inst.id?.slice(-4) || ''}`;
          if (currentChars + name.length > CHAR_BUDGET) {
            truncated = true;
            break;
          }
          nodeNames.push(name);
          currentChars += name.length + 2; // +2 for separator overhead
        }

        const edgeCount = Array.isArray(activeGraphData.edgeIds) ? activeGraphData.edgeIds.length : 0;

        graphStructure = {
          id: activeGraphId,
          name: activeGraphData.name || 'Unnamed',
          nodeCount: instances.length,
          edgeCount,
          nodes: nodeNames,
          truncated
        };
      }

      // Build graph state for new Wizard endpoint
      // CRITICAL: Convert Map objects to arrays for JSON serialization
      const graphState = {
        graphs: activeGraphId && graphsMap ? Array.from(graphsMap.values()).map(g => {
          // Convert instances Map to array for serialization
          const instancesArray = g.instances instanceof Map
            ? Array.from(g.instances.values())
            : Array.isArray(g.instances)
              ? g.instances
              : Object.values(g.instances || {});

          return {
            id: g.id,
            name: g.name,
            instances: instancesArray,
            edgeIds: g.edgeIds || [],
            groups: g.groups instanceof Map
              ? Array.from(g.groups.values())
              : Array.isArray(g.groups)
                ? g.groups
                : Object.values(g.groups || {})
          };
        }) : [],
        nodePrototypes: activeGraphData ? (() => {
          const instances = activeGraphData.instances instanceof Map
            ? Array.from(activeGraphData.instances.values())
            : Array.isArray(activeGraphData.instances)
              ? activeGraphData.instances
              : Object.values(activeGraphData.instances || {});
          const protoMap = new Map();
          instances.forEach(inst => {
            if (inst.prototypeId && !protoMap.has(inst.prototypeId)) {
              const fullNodeData = nodePrototypesMap ? nodePrototypesMap.get(inst.prototypeId) : null;
              protoMap.set(inst.prototypeId, {
                id: inst.prototypeId,
                name: fullNodeData?.name || inst.name,
                color: fullNodeData?.color || inst.color,
                description: fullNodeData?.description || inst.description
              });
            }
          });
          return Array.from(protoMap.values());
        })() : [],
        // Extract edges from edgesMap for the active graph
        edges: activeGraphData && edgesMap ? (() => {
          const edgeIds = activeGraphData.edgeIds || [];
          return edgeIds.map(edgeId => {
            const edge = edgesMap.get(edgeId);
            if (!edge) return null;
            return {
              id: edgeId,
              sourceId: edge.sourceId,
              targetId: edge.targetId,
              type: edge.type || edge.connectionType || 'relates to'
            };
          }).filter(Boolean);
        })() : [],
        activeGraphId: activeGraphId || null
      };

      console.log('[Wizard] Starting request to /api/wizard', {
        apiKey: apiKey ? 'present' : 'missing',
        apiConfig,
        historyLength: recentMessages.length
      });

      // Auto-correct provider if key mismatches (fixes common 401 error)
      let effectiveProvider = apiConfig?.provider;
      if (apiKey?.startsWith('sk-ant-') && (!effectiveProvider || effectiveProvider === 'openrouter')) {
        console.warn('[LeftAIView] Detected Anthropic key with OpenRouter config. Auto-switching to Anthropic.');
        effectiveProvider = 'anthropic';
      } else if (apiKey?.startsWith('sk-proj-') && (!effectiveProvider || effectiveProvider === 'openrouter')) {
        effectiveProvider = 'openai';
      }

      // Use new Wizard endpoint with SSE streaming
      const response = await bridgeFetch('/api/wizard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          message: question,
          graphState,
          conversationHistory: recentMessages, // Include conversation history for context
          config: {
            cid: `wizard-${Date.now()}`,
            systemPrompt: persona === 'druid' ? DRUID_SYSTEM_PROMPT : undefined,
            apiConfig: apiConfig ? {
              provider: effectiveProvider || apiConfig.provider,
              endpoint: apiConfig.endpoint,
              model: apiConfig.model,
              settings: apiConfig.settings
            } : null
          }
        }),
        signal: abortController.signal
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Wizard request failed (${response.status}): ${errorBody}`);
      }

      // Process SSE stream
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      // Track processed event IDs to prevent duplicates (React StrictMode safety)
      const processedEvents = new Set();
      let eventCounter = 0;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              try {
                const event = JSON.parse(data);

                // Generate unique event ID for deduplication
                const eventId = `${event.type}-${event.id || eventCounter++}-${event.content?.length || 0}`;
                if (processedEvents.has(eventId)) continue;
                processedEvents.add(eventId);

                // Apply tool results to store OUTSIDE the state updater
                // to avoid double-execution in React StrictMode
                if (event.type === 'tool_result') {
                  applyToolResultToStore(event.name, event.result);
                }

                // Update streaming message based on event type
                setMessages(prev => {
                  const updated = [...prev];
                  // Find THIS streaming message by ID, not just any AI message
                  let idx = updated.findIndex(m => m.id === streamingMessageId);
                  if (idx < 0) {
                    // Create new AI message for this stream
                    updated.push({
                      id: streamingMessageId,
                      sender: 'ai',
                      content: '',
                      timestamp: new Date().toISOString(),
                      toolCalls: [],
                      isStreaming: true
                    });
                    idx = updated.length - 1;
                  }

                  const msg = { ...updated[idx] };

                  if (event.type === 'tool_call') {
                    // Add or update tool call
                    const toolCalls = Array.isArray(msg.toolCalls) ? [...msg.toolCalls] : [];
                    const existingIndex = toolCalls.findIndex(tc => tc.id === event.id);
                    if (existingIndex >= 0) {
                      toolCalls[existingIndex] = {
                        ...toolCalls[existingIndex],
                        name: event.name,
                        args: event.args,
                        status: 'running'
                      };
                    } else {
                      toolCalls.push({
                        id: event.id,
                        name: event.name,
                        args: event.args,
                        status: 'running',
                        expanded: false
                      });
                    }
                    msg.toolCalls = toolCalls;
                  } else if (event.type === 'tool_result') {
                    // Update tool call with result
                    const toolCalls = Array.isArray(msg.toolCalls) ? [...msg.toolCalls] : [];
                    const toolIndex = toolCalls.findIndex(tc => tc.id === event.id);
                    if (toolIndex >= 0) {
                      toolCalls[toolIndex] = {
                        ...toolCalls[toolIndex],
                        status: event.result?.error ? 'failed' : 'completed',
                        result: event.result,
                        error: event.result?.error
                      };
                    }
                    msg.toolCalls = toolCalls;
                  } else if (event.type === 'response') {
                    // Stream response text - accumulate from existing state, not external variable
                    msg.content = (msg.content || '') + (event.content || '');
                  } else if (event.type === 'error') {
                    msg.content = `Error: ${event.message}`;
                    msg.isStreaming = false;
                  } else if (event.type === 'done') {
                    msg.isStreaming = false;
                    msg.iterations = event.iterations;
                    // Trim trailing whitespace from accumulated content
                    if (msg.content) msg.content = msg.content.trimEnd();
                  }

                  updated[idx] = msg;
                  return updated;
                });
              } catch (e) {
                console.warn('[Wizard] Failed to parse SSE event:', e, data);
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
      setIsConnected(true);
    } catch (error) {
      if (error.name !== 'AbortError') {
        console.error('[AI Collaboration] Autonomous agent failed:', error);
        // Update or create streaming message with error
        setMessages(prev => {
          const updated = [...prev];
          const idx = updated.findIndex(m => m.id === streamingMessageId);
          if (idx >= 0) {
            updated[idx] = { ...updated[idx], content: `Error: ${error.message}`, isStreaming: false };
            return updated;
          }
          // If no streaming message yet, create one with the error
          return [...prev, { id: streamingMessageId, sender: 'ai', content: `Error: ${error.message}`, timestamp: new Date().toISOString(), toolCalls: [], isStreaming: false }];
        });
      }
    } finally {
      setCurrentAgentRequest(null);
    }
  };

  const handleQuestion = async (question) => {
    try {
      const apiConfig = await apiKeyManager.getAPIKeyInfo();
      if (!apiConfig) { addMessage('ai', 'Please set up your API key first by clicking the key icon in the header.'); return; }
      const apiKey = await apiKeyManager.getAPIKey();
      if (!apiKey) { addMessage('ai', 'No API key found. Please set one via the key icon.'); return; }
      const response = await bridgeFetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          message: question,
          systemPrompt: 'You are a concise Redstring copilot. Reference the active graph when possible and keep answers grounded.',
          context: {
            activeGraphId: activeGraphId || null,
            graphInfo,
            graphCount,
            apiConfig: apiConfig ? { provider: apiConfig.provider, endpoint: apiConfig.endpoint, model: apiConfig.model, settings: apiConfig.settings } : null
          },
          model: apiConfig?.model || undefined
        })
      });
      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Chat request failed (${response.status}): ${errorBody}`);
      }
      const data = await response.json();
      addMessage('ai', data.response || 'No response received from the model.');
      setIsConnected(true);
    } catch (error) {
      console.error('[AI Collaboration] Question handling failed:', error);
      addMessage('ai', error.message?.includes('API key') ? error.message : 'I encountered an error while processing your question. Please try again or check your bridge connection.');
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); }
  };

  const toggleClearance = HEADER_HEIGHT + 14;
  const [fileStatus, setFileStatus] = React.useState(null);
  React.useEffect(() => {
    let mounted = true;
    const fetchFileStatus = async () => {
      try {
        const mod = fileStorage;
        if (typeof mod.getFileStatus === 'function') {
          const status = mod.getFileStatus();
          if (mounted) setFileStatus(status);
        }
      } catch { }
    };
    fetchFileStatus();
    const t = setInterval(fetchFileStatus, 3000);
    return () => { mounted = false; clearInterval(t); };
  }, []);

  const handleCopyConversation = () => {
    const conversationText = messages.map(msg => {
      const sender = msg.sender === 'user' ? 'User' : msg.sender === 'ai' ? 'AI' : 'System';
      let text = `${sender}: ${msg.content}`;

      const meta = [];
      const toolCallsToLog = msg.toolCalls && msg.toolCalls.length > 0
        ? msg.toolCalls
        : (msg.metadata && msg.metadata.toolCalls ? msg.metadata.toolCalls : []);

      if (toolCallsToLog.length > 0) {
        meta.push('\n  Tool Calls:');
        toolCallsToLog.forEach((tc, idx) => {
          meta.push(`\n    ${idx + 1}. ${tc.name || 'unknown'} (${tc.status || 'unknown'})`);
          if (tc.args) {
            meta.push(`\n       Args: ${JSON.stringify(tc.args, null, 2).replace(/\n/g, '\n       ')}`);
          }
          if (tc.result) {
            meta.push(`\n       Result: ${JSON.stringify(tc.result, null, 2).replace(/\n/g, '\n       ')}`);
          }
          if (tc.error) {
            meta.push(`\n       Error: ${tc.error}`);
          }
        });
      }

      if (msg.metadata) {
        if (msg.metadata.mode) {
          meta.push(`\n  Mode: ${msg.metadata.mode}`);
        }
        if (msg.metadata.iterations) {
          meta.push(`\n  Iterations: ${msg.metadata.iterations}`);
        }
        if (msg.metadata.isComplete !== undefined) {
          meta.push(`\n  Complete: ${msg.metadata.isComplete}`);
        }
      }

      if (meta.length > 0) {
        text += meta.join('');
      }

      return text;
    }).join('\n\n');

    navigator.clipboard.writeText(conversationText).then(() => {
      addMessage('system', '📋 Conversation copied to clipboard');
    }).catch(err => {
      console.error('Failed to copy:', err);
      addMessage('system', '❌ Failed to copy conversation');
    });
  };

  const handleClearConversation = () => {
    if (messages.length === 0) return;
    if (window.confirm('Clear entire conversation? This cannot be undone.')) {
      setMessages([]);
      try {
        const ts = Date.now();
        localStorage.setItem(RESET_TS_KEY, String(ts));
        localStorage.removeItem(STORAGE_KEY);
      } catch { }
      // Conversation cleared silently (no message)
    }
  };


  const headerActionsEl = (
    <div className="ai-header-actions">
      <button
        className={`ai-flat-button ${showAPIKeySetup ? 'active' : ''}`}
        onClick={() => setShowAPIKeySetup(!showAPIKeySetup)}
        title={hasAPIKey ? 'Manage API Key' : 'Setup API Key'}
      >
        <Key size={20} />
      </button>
      <button
        className="ai-flat-button"
        onClick={() => setShowAdvanced(!showAdvanced)}
        title="Advanced Options"
      >
        <Settings size={20} />
      </button>
      <div style={{ position: 'relative', display: 'inline-block' }}>
        <button
          className={`ai-flat-button ${showToolsDropdown ? 'active' : ''}`}
          onClick={() => setShowToolsDropdown(!showToolsDropdown)}
          title="Test Tool Calls"
        >
          <Wrench size={20} />
        </button>
        {showToolsDropdown && (
          <div className="ai-tools-dropdown" style={{
            position: 'absolute', top: '100%', right: 0,
            backgroundColor: '#1e1e1e',
            border: '1px solid #333',
            borderRadius: '4px', padding: '8px', zIndex: 100,
            width: '280px', maxHeight: '400px', overflowY: 'auto',
            boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
            marginTop: '4px',
            textAlign: 'left'
          }}>
            <div style={{ fontSize: '12px', fontWeight: 'bold', marginBottom: '8px', color: '#888', paddingBottom: '4px', borderBottom: '1px solid #333' }}>Available Tools (Click to test)</div>

            {/* Combine and map all tools */}
            {[...mcpClient.getAvailableTools(), ...wizardTools].map(tool => (
              <div
                key={tool.name}
                className="ai-tool-dropdown-item"
                style={{
                  padding: '8px', cursor: 'pointer',
                  borderBottom: '1px solid #2a2a2a'
                }}
                onClick={() => {
                  const props = tool.inputSchema?.properties || tool.parameters?.properties || {};
                  const schemaVars = Object.keys(props).reduce((acc, key) => {
                    const prop = props[key];
                    if (prop?.type === 'array') {
                      acc[key] = prop?.items?.type === 'string' ? ['example'] : [];
                    } else if (prop?.type === 'object') {
                      acc[key] = {};
                    } else if (prop?.type === 'boolean') {
                      acc[key] = false;
                    } else if (prop?.type === 'number') {
                      acc[key] = 0;
                    } else {
                      // Provide better default strings based on property name
                      const lkey = key.toLowerCase();
                      if (lkey.includes('id')) acc[key] = '12345';
                      else if (lkey.includes('name')) acc[key] = 'Test Name';
                      else if (lkey.includes('color')) acc[key] = '#ff0000';
                      else if (lkey.includes('desc')) acc[key] = 'Test description';
                      else acc[key] = 'test_value';
                    }
                    return acc;
                  }, {});
                  setSelectedTestTool({
                    ...tool,
                    isMcpTool: mcpClient.getAvailableTools().some(t => t.name === tool.name)
                  });
                  setTestToolArgs(JSON.stringify(schemaVars, null, 2));
                  setShowToolsDropdown(false);
                }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#2a2a2a'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
              >
                <div style={{ color: '#e0e0e0', fontSize: '13px', fontWeight: '500' }}>
                  {tool.name}
                  {wizardTools.some(t => t.name === tool.name) && <span style={{ fontSize: '10px', color: '#888', marginLeft: '6px' }}>(Wizard)</span>}
                </div>
                <div style={{ color: '#888', fontSize: '11px', marginTop: '4px', lineHeight: '1.3' }}>{tool.description}</div>
              </div>
            ))}
            {mcpClient.getAvailableTools().length === 0 && wizardTools.length === 0 && (
              <div style={{ fontSize: '12px', color: '#888', padding: '8px', textAlign: 'center' }}>No tools available right now.<br />Connect to bridge first.</div>
            )}
          </div>
        )}
      </div>
      <button
        className="ai-flat-button"
        onClick={handleCopyConversation}
        title="Copy conversation to clipboard"
        disabled={messages.length === 0}
      >
        <Copy size={20} />
      </button>
      <button
        className="ai-flat-button"
        onClick={handleClearConversation}
        title="Clear conversation"
        disabled={messages.length === 0}
      >
        <Trash2 size={20} />
      </button>
      <button
        className={`ai-flat-button ${isConnected ? 'ai-refresh-button' : 'ai-connect-button'}`}
        onClick={refreshBridgeConnection}
        title={isConnected ? 'Bridge connected' : 'Reconnect bridge daemon'}
        disabled={isProcessing}
      >
        <RotateCcw size={20} />
      </button>

    </div>
  );

  return (
    <div className="ai-collaboration-panel">
      <div className="ai-panel-header">
        {!compact ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gridColumn: '1 / -1' }}>
            <div className="ai-mode-dropdown">
              <div className="ai-status-indicator-wrapper">
                <div className={`ai-status-indicator ${isConnected ? 'connected' : 'disconnected'}`} />
              </div>
              <select className="ai-mode-select" value={viewMode} onChange={(e) => setViewMode(e.target.value)} aria-label="Mode">
                <option value="wizard">Wizard</option>
                <option value="druid">The Druid</option>
                <option value="chat">Chat</option>
              </select>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              {headerActionsEl}
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', width: '100%', gridColumn: '1 / -1' }}>
            <div className="ai-mode-dropdown">
              <div className="ai-status-indicator-wrapper">
                <div className={`ai-status-indicator ${isConnected ? 'connected' : 'disconnected'}`} />
              </div>
              <select className="ai-mode-select" value={viewMode} onChange={(e) => setViewMode(e.target.value)} aria-label="Mode">
                <option value="wizard">Wizard</option>
                <option value="druid">The Druid</option>
                <option value="chat">Chat</option>
              </select>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-start', marginTop: 8, paddingLeft: 6 }}>
              {headerActionsEl}
            </div>
          </div>
        )}
      </div>

      {/* Dedicated graph info section below the header so layout is consistent across widths */}
      <div className="ai-graph-info-section" style={{ padding: '12px 0 12px 0' }}>
        <div className="ai-graph-info-left" style={{ paddingLeft: '6px' }}>
          <span className="ai-graph-name">{graphInfo.name}</span>
          <span className="ai-graph-stats">{graphInfo.nodeCount} nodes • {graphInfo.edgeCount} edges</span>
        </div>
      </div>
      {/* Dividing line below graph info section */}
      <StandardDivider margin="0" />

      {showAPIKeySetup && (
        <div className="ai-api-setup-section">
          <APIKeySetup onKeySet={() => checkAPIKey()} onClose={() => setShowAPIKeySetup(false)} inline={true} />
        </div>
      )}

      {selectedTestTool && (
        <div className="ai-tool-tester-modal" style={{
          position: 'absolute', top: '50px', right: '12px',
          width: '320px', backgroundColor: '#1e1e1e',
          border: '1px solid #333', borderRadius: '8px', padding: '12px', zIndex: 1000,
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          display: 'flex', flexDirection: 'column'
        }}>
          <h3 style={{ margin: '0 0 8px 0', color: '#e0e0e0', fontSize: '13px', borderBottom: '1px solid #333', paddingBottom: '6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Test: {selectedTestTool.name}</span>
            <span style={{ fontSize: '10px', color: '#666', fontWeight: 'normal', backgroundColor: '#2a2a2a', padding: '2px 4px', borderRadius: '4px' }}>
              {selectedTestTool.isMcpTool ? 'MCP' : 'WIZARD'}
            </span>
          </h3>
          <div style={{ color: '#aaa', fontSize: '11px', marginBottom: '12px', flexShrink: 0, lineHeight: '1.3' }}>{selectedTestTool.description}</div>
          <div style={{ fontSize: '11px', color: '#888', marginBottom: '6px', fontWeight: '500' }}>Arguments (JSON)</div>
          <textarea
            value={testToolArgs}
            onChange={(e) => setTestToolArgs(e.target.value)}
            style={{
              width: '100%', height: '120px', backgroundColor: '#0f0f0f',
              color: '#d4d4d4', fontFamily: 'monospace', fontSize: '11px', padding: '8px',
              border: '1px solid #333', borderRadius: '4px', marginBottom: '12px',
              resize: 'vertical', outline: 'none'
            }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', flexShrink: 0 }}>
            <button onClick={() => setSelectedTestTool(null)} className="ai-flat-button" style={{ padding: '6px 12px', fontSize: '11px', color: '#888' }}>Cancel</button>
            <button disabled={isProcessing} onClick={async () => {
              const toolName = selectedTestTool.name;
              const isMcpTool = selectedTestTool.isMcpTool;
              let parsedArgs = {};
              try {
                parsedArgs = JSON.parse(testToolArgs);
              } catch (e) {
                alert('Invalid JSON in arguments');
                return;
              }

              try {
                setIsProcessing(true);
                setSelectedTestTool(null);
                addMessage('user', `Manual execution: ${toolName}`);
                addMessage('system', `Executing tool manually: ${toolName}...`);

                if (isMcpTool) {
                  const result = await mcpClient.callTool(toolName, parsedArgs);
                  addMessage('system', `**Result for ${toolName}:**\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``);
                } else {
                  const graphState = {
                    activeGraphId,
                    graphs: activeGraphId && graphsMap ? Array.from(graphsMap.values()).map(g => ({
                      id: g.id, name: g.name,
                      instances: g.instances instanceof Map ? Array.from(g.instances.values()) : Object.values(g.instances || {}),
                      edgeIds: g.edgeIds || [],
                      groups: g.groups instanceof Map ? Array.from(g.groups.values()) : Object.values(g.groups || {})
                    })) : [],
                    edges: activeGraphId && edgesMap ? (() => {
                      const graph = graphsMap.get(activeGraphId);
                      if (!graph) return [];
                      return (graph.edgeIds || []).map(edgeId => {
                        const edge = edgesMap.get(edgeId);
                        if (!edge) return null;
                        return {
                          id: edgeId, sourceId: edge.sourceId, targetId: edge.targetId,
                          type: edge.type || edge.connectionType || 'relates to'
                        };
                      }).filter(Boolean);
                    })() : []
                  };

                  const apiKey = await apiKeyManager.getAPIKey();
                  const headers = { 'Content-Type': 'application/json' };
                  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

                  const response = await bridgeFetch('/api/wizard/execute-tool', {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({ name: toolName, args: parsedArgs, graphState })
                  });

                  if (!response.ok) {
                    const errText = await response.text();
                    throw new Error(`Tool execution failed (${response.status}): ${errText}`);
                  }
                  const result = await response.json();
                  addMessage('system', `**Result for ${toolName}:**\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``);
                }
              } catch (e) {
                addMessage('system', `❌ Error executing ${toolName}:\n${e.message}`);
              } finally {
                setIsProcessing(false);
              }
            }} className="ai-flat-button" style={{ backgroundColor: '#2a2a2a', padding: '6px 12px', fontSize: '11px', border: '1px solid #444', borderRadius: '4px', cursor: 'pointer', color: '#e0e0e0' }}>
              Execute {selectedTestTool.name}
            </button>
          </div>
        </div>
      )}



      <div className="ai-panel-content">
        <div className="ai-chat-mode">
          <div className="ai-messages" style={{ display: 'flex', flexDirection: 'column', height: '100%', justifyContent: messages.length === 0 ? 'center' : 'flex-start' }}>
            {isConnected && messages.length === 0 && (
              <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px 0' }}>
                <img src={fullBodySvg} alt="Wizard" style={{ width: '150px', marginBottom: '16px' }} />
                <div style={{ color: '#555', fontFamily: "'EmOne', sans-serif", fontSize: '14px' }}>What will we build today?</div>
              </div>
            )}
            {messages.map((message) => (
              <div key={message.id} className={`ai-message ai-message-${message.sender}`} style={{ alignSelf: message.sender === 'user' ? 'flex-end' : 'flex-start', maxWidth: '85%' }}>
                <div className="ai-message-avatar">
                  {message.sender === 'user' ? <User size={24} /> : message.sender === 'system' ? null : <img src={headSvg} alt="Wizard" style={{ width: 32, height: 32 }} />}
                </div>
                <div className="ai-message-content">
                  {/* Render text first, then tool calls below — natural reading order */}
                  {message.content && (
                    <div
                      className="ai-message-text"
                      style={{ userSelect: 'text', cursor: 'text' }}
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }}
                    />
                  )}
                  {message.toolCalls && message.toolCalls.length > 0 && (
                    <div className="ai-tool-calls">
                      {message.toolCalls.map((toolCall, index) => (
                        <ToolCallCard
                          key={index}
                          toolName={toolCall.name}
                          status={toolCall.status || 'running'}
                          args={toolCall.args}
                          result={toolCall.result}
                          error={toolCall.error}
                          timestamp={toolCall.timestamp}
                          executionTime={toolCall.executionTime}
                        />
                      ))}
                    </div>
                  )}
                  <div className="ai-message-timestamp">{new Date(message.timestamp).toLocaleTimeString()}</div>
                </div>
              </div>
            ))}
            {isProcessing && (() => {
              // Find the streaming message to check if it has content
              const streamingMsg = messages.find(m => m.isStreaming);
              const hasStreamingContent = streamingMsg && (streamingMsg.content || (streamingMsg.toolCalls && streamingMsg.toolCalls.length > 0));

              // Only show thinking dots if no streaming content yet
              if (!hasStreamingContent) {
                return (
                  <div className="ai-thinking-row">
                    <div className="ai-message-avatar"><img src={headSvg} alt="Wizard" style={{ width: 32, height: 32 }} /></div>
                    <span className="ai-thinking-dots">
                      <span>•</span>
                      <span>•</span>
                      <span>•</span>
                    </span>
                  </div>
                );
              }
              return null;
            })()}
            <div ref={messagesEndRef} />
          </div>
          <div className="ai-input-container" style={{ marginBottom: toggleClearance }}>
            <textarea ref={inputRef} value={currentInput} onChange={(e) => setCurrentInput(e.target.value)} onKeyPress={handleKeyPress} placeholder={viewMode === 'druid' ? "Share an observation and I'll build upon it..." : viewMode === 'wizard' ? "Write your vision and I'll cast my spells..." : "Ask me anything about your knowledge graph..."} disabled={isProcessing} className="ai-input" rows={2} />
            {isProcessing && currentAgentRequest ? (
              <button onClick={handleStopAgent} className="ai-stop-button" title="Stop Agent"><Square fill="#DEDADA" color="#DEDADA" /></button>
            ) : (
              <button onClick={handleSendMessage} disabled={!currentInput.trim() || isProcessing} className="ai-send-button"><Send /></button>
            )}
          </div>
        </div>
      </div>

    </div>
  );
};

export default LeftAIView;
