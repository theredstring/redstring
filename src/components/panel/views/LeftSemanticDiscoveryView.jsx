import React, { useState, useEffect } from 'react';
import { Search, Loader2, X, RotateCcw } from 'lucide-react';
import ToggleSlider from '../../ToggleSlider.jsx';
import DraggableConceptCard from '../items/DraggableConceptCard.jsx';
import GhostSemanticNode from '../items/GhostSemanticNode.jsx';
import { enhancedSemanticSearch } from '../../../services/semanticWebQuery.js';
import { knowledgeFederation } from '../../../services/knowledgeFederation.js';
import { normalizeToCandidate, candidateToConcept } from '../../../services/candidates.js';

// Generate deterministic concept colors (matches Panel view)
const generateConceptColor = (name) => {
  const hues = [0, 25, 90, 140, 200, 260, 300];

  const hsvToHex = (h, s, v) => {
    const c = v * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = v - c;

    let r; let g; let b;
    if (h >= 0 && h < 60) { r = c; g = x; b = 0; }
    else if (h >= 60 && h < 120) { r = x; g = c; b = 0; }
    else if (h >= 120 && h < 180) { r = 0; g = c; b = x; }
    else if (h >= 180 && h < 240) { r = 0; g = x; b = c; }
    else if (h >= 240 && h < 300) { r = x; g = 0; b = c; }
    else { r = c; g = 0; b = x; }

    r = Math.round((r + m) * 255);
    g = Math.round((g + m) * 255);
    b = Math.round((b + m) * 255);

    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  };

  const targetSaturation = 1.0;
  const targetBrightness = 0.545;

  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash + name.charCodeAt(i)) & 0xffffffff;
  }

  const hueIndex = Math.abs(hash) % hues.length;
  const hue = hues[hueIndex];

  return hsvToHex(hue, targetSaturation, targetBrightness);
};

// Left Semantic Discovery View - Concept Discovery Engine
const LeftSemanticDiscoveryView = ({ storeActions, nodePrototypesMap, openRightPanelNodeTab, rightPanelTabs, activeDefinitionNodeId, selectedInstanceIds = new Set(), hydratedNodes = [] }) => {
  const [isSearching, setIsSearching] = useState(false);
  const [discoveredConcepts, setDiscoveredConcepts] = useState([]);
  const [searchHistory, setSearchHistory] = useState([]);
  const [selectedConcept, setSelectedConcept] = useState(null);
  const [viewMode, setViewMode] = useState('discover'); // 'discover', 'history', 'advanced'
  const [manualQuery, setManualQuery] = useState('');
  const [expandingNodeId, setExpandingNodeId] = useState(null);
  const [semanticExpansionResults, setSemanticExpansionResults] = useState([]);
  const [searchProgress, setSearchProgress] = useState('');

  // Persist discovery history and search results across sessions (localStorage)
  useEffect(() => {
    try {
      const historyRaw = localStorage.getItem('redstring_semantic_discovery_history');
      if (historyRaw) {
        const parsed = JSON.parse(historyRaw).map((item) => ({
          ...item,
          timestamp: item.timestamp ? new Date(item.timestamp) : new Date(),
        }));
        setSearchHistory(parsed);
      }
      
      const resultsRaw = localStorage.getItem('redstring_semantic_search_results');
      if (resultsRaw) {
        const results = JSON.parse(resultsRaw);
        setDiscoveredConcepts(results);
      }
    } catch (e) {
      console.warn('[SemanticDiscovery] Failed to load from storage', e);
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('redstring_semantic_discovery_history', JSON.stringify(searchHistory));
    } catch (e) {
      // Non-fatal
    }
  }, [searchHistory]);

  useEffect(() => {
    try {
      localStorage.setItem('redstring_semantic_search_results', JSON.stringify(discoveredConcepts));
    } catch (e) {
      // Non-fatal
    }
  }, [discoveredConcepts]);

  const handleDeleteHistoryItem = (id) => {
    setSearchHistory((prev) => prev.filter((h) => h.id !== id));
  };

  const handleClearHistory = () => {
    setSearchHistory([]);
  };

  // Get dual context (panel + graph)
  const getContexts = () => {
    const contexts = { panel: null, graph: null };
    
    // Panel context: active tab in right panel
    const activeTab = rightPanelTabs?.find(tab => tab.isActive);
    if (activeTab && activeTab.nodeId) {
      const nodeData = nodePrototypesMap.get(activeTab.nodeId);
      
      // Only create panel context if the node actually exists
      if (nodeData && nodeData.name) {
        contexts.panel = {
          nodeId: activeTab.nodeId,
          nodeName: nodeData.name,
          nodeData: nodeData,
          type: 'panel'
        };
      } else {
        // Log stale reference for debugging
        console.warn(`[SemanticDiscovery] Stale panel tab nodeId: ${activeTab.nodeId} - prototype not found or missing name`);
      }
    }
    
    // Graph context: active definition node (what's highlighted in header)
    if (activeDefinitionNodeId && activeDefinitionNodeId !== contexts.panel?.nodeId) {
      const nodeData = nodePrototypesMap.get(activeDefinitionNodeId);
      
      // Only create graph context if the node actually exists
      if (nodeData && nodeData.name) {
        contexts.graph = {
          nodeId: activeDefinitionNodeId,
          nodeName: nodeData.name, 
          nodeData: nodeData,
          type: 'graph'
        };
      } else {
        // Log stale reference for debugging (only once per session)
        if (!window._staleNodeWarnings) window._staleNodeWarnings = new Set();
        if (!window._staleNodeWarnings.has(activeDefinitionNodeId)) {
          console.warn(`[SemanticDiscovery] Stale activeDefinitionNodeId: ${activeDefinitionNodeId} - prototype not found or missing name`);
          window._staleNodeWarnings.add(activeDefinitionNodeId);
        }
        // Clear the stale reference to prevent repeated warnings
        // Note: This would require access to storeActions to actually clear it
      }
    }
    
    return contexts;
  };

  const contexts = getContexts();
  const primaryContext = contexts.panel || contexts.graph;
  const searchQuery = primaryContext?.nodeName || '';
  
  // Get selected node information from canvas
  const selectedNode = selectedInstanceIds.size === 1 
    ? hydratedNodes.find(node => selectedInstanceIds.has(node.id))
    : null;

  // Search for concepts using current context
  const handleConceptSearch = async () => {
    if (!searchQuery.trim()) return;
    await performSearch(searchQuery);
  };

  // Manual search with custom query
  const handleManualSearch = async () => {
    if (!manualQuery?.trim()) return;
    await performSearch(manualQuery);
  };

  // Semantic expansion for selected node - Use knowledge federation for better results
  const performSemanticExpansion = async (nodeName, nodeId) => {
    setIsSearching(true);
    try {
      // Use knowledge federation for relationship-based expansion (like mass import)
      console.log(`[SemanticExpansion] Starting knowledge federation expansion for "${nodeName}"`);
      const results = await knowledgeFederation.importKnowledgeCluster(nodeName, {
        maxDepth: 1, // Focus on immediate relationships for expansion
        maxEntitiesPerLevel: 20, // Get focused results for expansion
        includeRelationships: true,
        includeSources: ['wikidata', 'dbpedia', 'conceptnet'],
        onProgress: (progress) => {
          console.log(`[SemanticExpansion] Progress: ${progress.stage} - ${progress.entity} (level ${progress.level})`);
        }
      });
      
      // Convert to expansion results with proper positioning info
      const expansionResults = Array.from(results.entities.entries()).map(([entityName, entityData]) => {
        // Skip the seed entity itself
        if (entityName === nodeName) return null;
        
        // Get relationships for this entity
        const entityRelationships = results.relationships
          .filter(rel => rel.source === entityName || rel.target === entityName)
          .slice(0, 3);
        
        // Get the best description from available sources
        const bestDescription = entityData.descriptions && entityData.descriptions.length > 0
          ? entityData.descriptions[0].text
          : `Related to ${nodeName}`;
        
        // Get the best type from available sources
        const bestType = entityData.types && entityData.types.length > 0
          ? entityData.types[0]
          : 'Thing';
        
        return {
          id: `expansion-${entityName.replace(/\s+/g, '_')}`,
          name: cleanTitle(entityName),
          description: bestDescription,
          category: bestType,
          source: entityData.sources?.join(', ') || 'federated',
          confidence: entityData.confidence || 0.8,
          relationships: entityRelationships,
          semanticMetadata: {
            originalUri: entityData.externalLinks?.[0],
            equivalentClasses: entityData.types || [],
            externalLinks: entityData.externalLinks || [],
            confidence: entityData.confidence || 0.8,
            connectionInfo: {
              type: 'expansion',
              value: 'related_via_federation',
              originalEntity: nodeName
            }
          },
          color: generateConceptColor(entityName),
          expandedFrom: nodeId,
          discoveredAt: new Date().toISOString()
        };
      }).filter(Boolean); // Remove null entries
      
      console.log(`[SemanticExpansion] Found ${expansionResults.length} expansion concepts`);
      setSemanticExpansionResults(expansionResults);
      
    } catch (error) {
      console.error('[SemanticExpansion] Failed:', error);
    } finally {
      setIsSearching(false);
    }
  };


  // --- Search utilities: normalization, variants, caching, ranking ---
  const searchCacheRef = React.useRef(new Map());
  const latestSearchTokenRef = React.useRef(null);

  const CACHE_TTL_MS = 5 * 60 * 1000;

  const normalizeQuery = (q) => {
    if (!q) return '';
    let s = String(q).trim();
    // Remove surrounding quotes
    s = s.replace(/^"|"$/g, '').replace(/^'|'$/g, '');
    // Collapse whitespace
    s = s.replace(/\s+/g, ' ').trim();
    return s;
  };

  const stripParentheses = (q) => q.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();

  const generateQueryVariants = (q) => {
    const base = normalizeQuery(q);
    const noParens = stripParentheses(base);
    const variants = new Set([base]);
    if (noParens && noParens.toLowerCase() !== base.toLowerCase()) variants.add(noParens);
    return Array.from(variants);
  };

  const isJunkName = (name) => {
    if (!name) return true;
    const n = name.toLowerCase();
    return n.startsWith('category:') || n.startsWith('template:') || n.startsWith('list of ') ||
           n.includes('disambiguation') || n.startsWith('wikipedia:') || n.startsWith('wikimedia');
  };

  const isJunkType = (t) => {
    if (!t) return false;
    const n = String(t).toLowerCase();
    return n.includes('disambiguation page') || n === 'human name' || n === 'given name' || n === 'family name' || n.includes('wikimedia');
  };

  const canonicalKey = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  const scoreConcept = (concept, qNorm) => {
    let score = 0;
    const conf = concept?.semanticMetadata?.confidence ?? 0.5;
    score += Math.round(conf * 50);
    const name = concept?.name || '';
    const desc = concept?.description || '';
    if (qNorm && name.toLowerCase().includes(qNorm.toLowerCase())) score += 40;
    if (qNorm && desc.toLowerCase().includes(qNorm.toLowerCase())) score += 20;
    if (Array.isArray(concept.relationships) && concept.relationships.length > 0) score += 10;
    if (isJunkName(name)) score -= 60;
    if (isJunkType(concept?.category)) score -= 40;
    if ((name || '').length <= 2) score -= 20;
    return score;
  };

  const convertFederationResultToConcepts = (results, queryForConn, sliceRelationshipsTo = 5) => {
    if (!results || !results.entities) return [];
    return Array.from(results.entities.entries()).map(([entityName, entityData]) => {
      const entityRelationships = (results.relationships || [])
        .filter(rel => rel.source === entityName || rel.target === entityName)
        .slice(0, sliceRelationshipsTo);
      const bestDescription = entityData.descriptions && entityData.descriptions.length > 0
        ? entityData.descriptions[0].text
        : `A concept related to ${queryForConn}`;
      const bestType = entityData.types && entityData.types.length > 0 ? entityData.types[0] : 'Thing';
      return {
        id: `federation-${entityName.replace(/\s+/g, '_')}`,
        name: cleanTitle(entityName),
        description: bestDescription,
        category: bestType,
        source: entityData.sources?.join(', ') || 'federated',
        relationships: entityRelationships,
        semanticMetadata: {
          originalUri: entityData.externalLinks?.[0],
          equivalentClasses: entityData.types || [],
          externalLinks: entityData.externalLinks || [],
          confidence: entityData.confidence || 0.8,
          connectionInfo: {
            type: 'federated',
            value: entityName === queryForConn ? 'seed_entity' : 'related_entity',
            originalEntity: queryForConn
          }
        },
        color: generateConceptColor(entityName),
        discoveredAt: new Date().toISOString(),
        searchQuery: queryForConn
      };
    });
  };

  const fetchFederatedConcepts = async (query, options) => {
    const { maxDepth, maxEntitiesPerLevel } = options || {};
    const cacheKey = `${query}::d${maxDepth || 1}::p${maxEntitiesPerLevel || 15}`;
    const now = Date.now();
    const cached = searchCacheRef.current.get(cacheKey);
    if (cached && now - cached.ts < CACHE_TTL_MS) {
      return cached.data;
    }
    const results = await knowledgeFederation.importKnowledgeCluster(query, {
      maxDepth: maxDepth ?? 1,
      maxEntitiesPerLevel: maxEntitiesPerLevel ?? 15,
      includeRelationships: true,
      includeSources: ['wikidata', 'dbpedia', 'conceptnet'],
      onProgress: (progress) => {
        // Throttle logs implicitly by federation impl; keep lightweight here
      }
    });
    const concepts = convertFederationResultToConcepts(results, query);
    searchCacheRef.current.set(cacheKey, { ts: now, data: concepts });
    return concepts;
  };

  const filterRankDedup = (concepts, q) => {
    const qNorm = normalizeQuery(q);
    const seen = new Set();
    const filtered = [];
    for (const c of concepts) {
      const key = canonicalKey(c.name);
      if (!key || seen.has(key)) continue;
      if (isJunkName(c.name) || isJunkType(c.category)) continue;
      const conf = c?.semanticMetadata?.confidence ?? 0.5;
      if (conf < 0.35) continue;
      seen.add(key);
      filtered.push({ c, s: scoreConcept(c, qNorm) });
    }
    filtered.sort((a, b) => b.s - a.s);
    return filtered.map(x => x.c);
  };

  // Common search logic with normalization, variants, shallow-first, caching, ranking
  const performSearch = async (rawQuery) => {
    const variants = generateQueryVariants(rawQuery);
    const token = `search-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
    latestSearchTokenRef.current = token;
    setIsSearching(true);
    setDiscoveredConcepts([]);
    setSelectedConcept(null);
    setSearchProgress('Initializing search...');
    
    try {
      console.log(`[SemanticDiscovery] Starting search for "${rawQuery}" (token: ${token})`);
      setSearchProgress('Pulling strings...');
      
      // Shallow, fast searches for all variants in parallel
      const variantPromises = variants.map(v => fetchFederatedConcepts(v, { maxDepth: 1, maxEntitiesPerLevel: 15 }));
      const variantResults = await Promise.allSettled(variantPromises);
      
      setSearchProgress('Processing and ranking results...');
      
      let combined = [];
      variantResults.forEach((res, idx) => {
        if (res.status === 'fulfilled' && Array.isArray(res.value)) {
          combined = combined.concat(res.value);
        } else {
          console.warn('[SemanticDiscovery] Variant search failed:', variants[idx], res.reason);
        }
      });
      const ranked = filterRankDedup(combined, rawQuery).slice(0, 30); // Cap initial set
      if (latestSearchTokenRef.current !== token) return; // stale
      console.log(`[SemanticDiscovery] Showing ${ranked.length} ranked concepts (from ${combined.length} raw)`);
      // Normalize to Candidate then convert to concept shape for drag payload
      const normalized = ranked.map(r => candidateToConcept(normalizeToCandidate(r)));
      setDiscoveredConcepts(normalized);
      const historyItem = {
        id: token,
        query: normalizeQuery(rawQuery),
        timestamp: new Date(),
        resultCount: normalized.length,
        concepts: normalized.slice(0, 10)
      };
      setSearchHistory(prev => [historyItem, ...prev].slice(0, 20));
    } catch (error) {
      console.error('[SemanticDiscovery] Search failed:', error);
      if (latestSearchTokenRef.current !== token) return;
      setDiscoveredConcepts([]);
      setSearchProgress('Search failed');
    } finally {
      if (latestSearchTokenRef.current === token) {
        setIsSearching(false);
        setSearchProgress('');
      }
    }
  };
  
  // Function to trigger search from individual concept cards
  const triggerSearchFromConcept = async (conceptName) => {
    console.log(`[SemanticDiscovery] Triggering search for concept: "${conceptName}"`);
    setManualQuery(conceptName);
    await performSearch(conceptName);
  };
  
  // Expose search function globally for concept card search buttons
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.triggerSemanticSearch = triggerSearchFromConcept;
    }
    
    return () => {
      if (typeof window !== 'undefined') {
        delete window.triggerSemanticSearch;
      }
    };
  }, []);
  
  // Clean and capitalize titles from semantic web
  const cleanTitle = (name) => {
    if (!name) return 'Unknown';
    
    // Remove common prefixes and clean up
    let cleaned = name
      .replace(/^(Q\d+|P\d+)\s*-?\s*/i, '') // Remove Wikidata IDs
      .replace(/\(disambiguation\)/gi, '') // Remove disambiguation markers
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
    
    // Capitalize properly - handle acronyms and proper nouns
    cleaned = cleaned
      .split(' ')
      .map(word => {
        // Keep common acronyms uppercase
        if (/^[A-Z]{2,}$/.test(word)) return word;
        // Keep known abbreviations
        if (['AI', 'ML', 'API', 'HTTP', 'URL', 'DNA', 'RNA', 'CEO', 'CTO'].includes(word.toUpperCase())) {
          return word.toUpperCase();
        }
        // Capitalize first letter, lowercase rest
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      })
      .join(' ');
    
    return cleaned || 'Unknown Concept';
  };

  // Create Redstring node prototype from discovered concept
  const materializeConcept = (concept) => {
    // Check if this semantic concept already exists as a prototype
    const existingPrototype = Array.from(nodePrototypesMap.values()).find(proto => 
      proto.semanticMetadata?.isSemanticNode && 
      proto.name === concept.name &&
      proto.semanticMetadata?.originMetadata?.source === concept.source &&
      proto.semanticMetadata?.originMetadata?.originalUri === concept.semanticMetadata?.originalUri
    );
    
    if (existingPrototype) {
      // Use existing prototype
      console.log(`[SemanticDiscovery] Reusing existing semantic prototype: ${concept.name} (ID: ${existingPrototype.id})`);
      return existingPrototype.id;
    }
    
    // Create new prototype
    const newNodeId = `semantic-node-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Build origin metadata for the bio section
    const originInfo = {
      source: concept.source,
      discoveredAt: concept.discoveredAt,
      searchQuery: concept.searchQuery || '',
      confidence: concept.semanticMetadata?.confidence || 0.8,
      originalUri: concept.semanticMetadata?.originalUri,
      relationships: concept.relationships || []
    };
    
    // Use regular addNodePrototype since addNodePrototypeWithDeduplication may not be available
    if (storeActions?.addNodePrototype) {
      storeActions.addNodePrototype({
      id: newNodeId,
      name: concept.name,
      description: '', // No custom bio - will show origin info instead
      color: concept.color,
      typeNodeId: 'base-thing-prototype',
      definitionGraphIds: [],
      semanticMetadata: {
        ...concept.semanticMetadata,
        relationships: concept.relationships,
        originMetadata: originInfo,
        isSemanticNode: true,
        generatedColor: concept.color // Store the generated color for consistency
      },
      // Store the original description for potential use
      originalDescription: concept.description
      });
      
      // Auto-save semantic nodes to Library
      storeActions?.toggleSavedNode(newNodeId);
    } else {
      console.error('[SemanticDiscovery] storeActions.addNodePrototype is not available');
    }
    
    console.log(`[SemanticDiscovery] Created/merged semantic prototype: ${concept.name} (ID: ${newNodeId})`);
    return newNodeId;
  };

  // Remove saved semantic concept from the graph
  const unsaveConcept = (concept) => {
    // Find the existing prototype for this concept
    const existingPrototype = Array.from(nodePrototypesMap.values()).find(proto => 
      proto.semanticMetadata?.isSemanticNode && 
      proto.name === concept.name &&
      proto.semanticMetadata?.originMetadata?.source === concept.source &&
      proto.semanticMetadata?.originMetadata?.originalUri === concept.semanticMetadata?.originalUri
    );
    
    if (existingPrototype) {
      // Unsave the node from Library
      if (storeActions?.toggleSavedNode) {
        storeActions.toggleSavedNode(existingPrototype.id);
        console.log(`[SemanticDiscovery] Unsaved semantic prototype: ${concept.name} (ID: ${existingPrototype.id})`);
      } else {
        console.error('[SemanticDiscovery] storeActions.toggleSavedNode is not available');
      }
    } else {
      console.log(`[SemanticDiscovery] No existing prototype found to unsave: ${concept.name}`);
    }
  };

  // Debug logging
  console.log('[SemanticDiscovery] Rendering with viewMode:', viewMode);
  console.log('[SemanticDiscovery] Contexts:', contexts);
  console.log('[SemanticDiscovery] Manual query:', manualQuery);

  return (
    <>
      {/* Ghost animation CSS */}
      <style>
        {`
          @keyframes ghostFadeIn {
            0% {
              opacity: 0;
              transform: scale(0.5) translateY(10px);
            }
            50% {
              opacity: 0.4;
              transform: scale(0.8) translateY(5px);
            }
            100% {
              opacity: 0.8;
              transform: scale(1) translateY(0);
            }
          }
          
          @keyframes pulse {
            0%, 100% {
              opacity: 1;
              transform: scale(1);
            }
            50% {
              opacity: 0.6;
              transform: scale(1.1);
            }
          }
          
          @keyframes ghostFloat {
            0%, 100% {
              transform: translateY(0px);
            }
            50% {
              transform: translateY(-2px);
            }
          }
          
          @keyframes conceptSlideIn {
            0% {
              opacity: 0;
              transform: translateX(-10px);
            }
            100% {
              opacity: 1;
              transform: translateX(0);
            }
          }
          
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}
      </style>
      
      <div className="panel-content-inner semantic-discovery-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* Header */}
      <div className="semantic-discovery-header" style={{ marginBottom: '16px' }}>
        <h2 style={{ margin: 0, color: '#260000', userSelect: 'none', fontSize: '1.1rem', fontWeight: 'bold', fontFamily: "'EmOne', sans-serif", marginBottom: '12px' }}>
          Semantic Discovery
        </h2>
        <ToggleSlider
          options={[
            { value: 'discover', label: 'Discover' },
            { value: 'history', label: 'History' }
          ]}
          value={viewMode}
          onChange={setViewMode}
          rightContent={
            viewMode === 'history' && searchHistory.length > 0 ? (
              `${searchHistory.length} search${searchHistory.length !== 1 ? 'es' : ''}`
            ) : null
          }
        />
      </div>

      {viewMode === 'discover' && (
        <>
          {/* Enhanced Context Display */}
          {(contexts.panel || contexts.graph || selectedNode) && (
            <div className="contexts-display" style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: '11px', color: '#260000', fontFamily: "'EmOne', sans-serif", marginBottom: '8px', fontWeight: 'bold' }}>
                Quick Search
              </div>
              
              {/* Enhanced Action Grid - node-style representations */}
              <div style={{ display: 'grid', gap: '6px', marginBottom: '12px' }}>
                {contexts.panel && (
                  <div
                    onClick={() => {
                      const query = contexts.panel.nodeName;
                      if (query.trim()) {
                        performSearch(query);
                      }
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                      padding: '2px 0',
                      cursor: isSearching ? 'wait' : 'pointer',
                      userSelect: 'none'
                    }}
                    title="Quick search from Panel context"
                  >
                    <div style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '6px 10px',
                        borderRadius: '12px',
                        background: contexts.panel.nodeData?.color || '#8B0000'
                      }}>
                        <Search size={14} style={{ color: '#EFE8E5' }} />
                        <span style={{ color: '#EFE8E5', fontFamily: "'EmOne', sans-serif", fontSize: 12, fontWeight: 'bold', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 220 }}>
                          {contexts.panel.nodeName}
                        </span>
                      </div>
                    </div>
                    <div style={{ fontSize: 11, color: '#260000', fontFamily: "'EmOne', sans-serif", marginLeft: 0, paddingBottom: 6 }}>from Panel</div>
                  </div>
                )}

                {contexts.graph && (
                  <div
                    onClick={() => {
                      const query = contexts.graph.nodeName;
                      if (query.trim()) {
                        performSearch(query);
                      }
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                      padding: '2px 0',
                      cursor: isSearching ? 'wait' : 'pointer',
                      userSelect: 'none'
                    }}
                    title="Quick search from Graph context"
                  >
                    <div style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '6px 10px',
                        borderRadius: '12px',
                        background: contexts.graph.nodeData?.color || '#4B0082'
                      }}>
                        <Search size={14} style={{ color: '#EFE8E5' }} />
                        <span style={{ color: '#EFE8E5', fontFamily: "'EmOne', sans-serif", fontSize: 12, fontWeight: 'bold', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 220 }}>
                          {contexts.graph.nodeName}
                        </span>
                      </div>
                    </div>
                    <div style={{ fontSize: 11, color: '#260000', fontFamily: "'EmOne', sans-serif", marginLeft: 0, paddingBottom: 6 }}>from Active Web</div>
                  </div>
                )}

                {selectedNode && (
                  <div
                    onClick={() => {
                      const nodePrototype = nodePrototypesMap.get(selectedNode.prototypeId);
                      if (nodePrototype?.name) {
                        performSearch(nodePrototype.name);
                      }
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                      padding: '2px 0',
                      cursor: isSearching ? 'wait' : 'pointer',
                      userSelect: 'none'
                    }}
                    title="Quick search from Selected"
                  >
                    <div style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '6px 10px',
                        borderRadius: '12px',
                        background: (nodePrototypesMap.get(selectedNode.prototypeId)?.color) || '#228B22'
                      }}>
                        <Search size={14} style={{ color: '#EFE8E5' }} />
                        <span style={{ color: '#EFE8E5', fontFamily: "'EmOne', sans-serif", fontSize: 12, fontWeight: 'bold', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 220 }}>
                          {nodePrototypesMap.get(selectedNode.prototypeId)?.name || 'Selected'}
                        </span>
                      </div>
                    </div>
                    <div style={{ fontSize: 11, color: '#260000', fontFamily: "'EmOne', sans-serif", marginLeft: 0, paddingBottom: 6 }}>from Selected</div>
                  </div>
                )}
              </div>
            </div>
          )}
          
          {/* Manual Search Bar - Always visible */}
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '11px', color: '#260000', fontFamily: "'EmOne', sans-serif", marginBottom: '8px', fontWeight: 'bold' }}>
              Search Semantic Web
            </div>
            <div style={{ display: 'flex', gap: '6px' }}>
              <input
                type="text"
                value={manualQuery}
                onChange={(e) => setManualQuery(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleManualSearch()}
                placeholder="Search semantic web..."
                style={{
                  flex: 1,
                  padding: '6px 8px',
                  border: '1px solid #260000',
                  borderRadius: '4px',
                  fontSize: '11px',
                  fontFamily: "'EmOne', sans-serif",
                  background: 'transparent',
                  color: '#260000'
                }}
              />
              <button
                onClick={handleManualSearch}
                disabled={isSearching || !manualQuery?.trim()}
                style={{
                  padding: '6px 12px',
                  border: '1px solid #260000',
                  borderRadius: '4px',
                  background: 'transparent',
                  color: '#260000',
                  fontSize: '11px',
                  fontFamily: "'EmOne', sans-serif",
                  cursor: isSearching ? 'wait' : 'pointer',
                  fontWeight: 'bold',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                {isSearching ? (
                  <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                ) : (
                  <Search size={14} />
                )}
              </button>
            </div>
          </div>
          


          {/* Concept Results - Regular Search */}
          {discoveredConcepts.length > 0 && !semanticExpansionResults.length && (
            <div className="discovered-concepts" style={{ flex: 1, overflow: 'auto' }}>
              <div style={{ marginBottom: '12px', fontSize: '12px', color: '#260000', fontFamily: "'EmOne', sans-serif", fontWeight: 'bold' }}>
                Discovered Concepts ({discoveredConcepts.length})
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '8px' }}>
                {discoveredConcepts.map((concept, index) => (
                  <DraggableConceptCard
                    key={concept.id}
                    concept={concept}
                    index={index}
                    onMaterialize={materializeConcept}
                    onUnsave={unsaveConcept}
                    onSelect={setSelectedConcept}
                    isSelected={selectedConcept?.id === concept.id}
                  />
                ))}
              </div>
              
              {/* Load More Button */}
              {discoveredConcepts.length >= 10 && (
                <div style={{ marginTop: '12px', textAlign: 'center' }}>
                  <button
                    onClick={async () => {
                      const lastSearch = searchHistory[0];
                      if (!lastSearch) return;
                      try {
                        setIsSearching(true);
                        console.log(`[SemanticDiscovery] Loading more results for "${lastSearch.query}" with staged deeper search`);
                        const variants = generateQueryVariants(lastSearch.query);
                        const promises = variants.map(v => fetchFederatedConcepts(v, { maxDepth: 2, maxEntitiesPerLevel: 35 }));
                        const settled = await Promise.allSettled(promises);
                        let combined = [];
                        settled.forEach((res) => { if (res.status === 'fulfilled') combined = combined.concat(res.value || []); });
                        // Rank and dedup globally
                        const ranked = filterRankDedup(combined, lastSearch.query);
                        // Remove concepts already shown
                        const existingKeys = new Set(discoveredConcepts.map(c => canonicalKey(c.name)));
                        const normalizedAdditions = ranked
                          .filter(c => !existingKeys.has(canonicalKey(c.name)))
                          .slice(0, 40)
                          .map(r => candidateToConcept(normalizeToCandidate(r)));
                        console.log(`[SemanticDiscovery] Loaded ${normalizedAdditions.length} additional concepts (from ${combined.length} raw)`);
                        setDiscoveredConcepts(prev => [...prev, ...normalizedAdditions]);
                      } catch (error) {
                        console.error('[SemanticDiscovery] Load more failed:', error);
                      } finally {
                        setIsSearching(false);
                      }
                    }}
                    disabled={isSearching}
                    style={{
                      padding: '8px 16px',
                      border: '1px solid #666',
                      borderRadius: '6px',
                      background: isSearching ? '#333' : 'transparent',
                      color: isSearching ? '#888' : '#666',
                      fontSize: '10px',
                      cursor: isSearching ? 'wait' : 'pointer',
                      fontFamily: "'EmOne', sans-serif",
                      transition: 'all 0.2s ease'
                    }}
                    onMouseEnter={(e) => {
                      if (!isSearching) {
                        e.target.style.background = 'rgba(102, 102, 102, 0.1)';
                        e.target.style.borderColor = '#888';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isSearching) {
                        e.target.style.background = 'transparent';
                        e.target.style.borderColor = '#666';
                      }
                    }}
                  >
                    {isSearching ? 'Loading...' : 'Load More'}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Loading indicator for regular search */}
          {isSearching && !expandingNodeId && discoveredConcepts.length === 0 && (
            <div className="semantic-search-loading" style={{ flex: 1, overflow: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', padding: '20px' }}>
              <div style={{
                width: '32px',
                height: '32px',
                border: '3px solid #bdb5b5',
                borderTop: '3px solid #7A0000',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite',
                marginBottom: '12px',
                flexShrink: 0
              }} />
              <div style={{ 
                fontSize: '12px', 
                color: '#260000', 
                fontFamily: "'EmOne', sans-serif", 
                fontWeight: 'bold',
                marginBottom: '8px'
              }}>
                Searching semantic web...
              </div>
              <div style={{ 
                fontSize: '10px', 
                color: '#666',
                fontFamily: "'EmOne', sans-serif",
                textAlign: 'center'
              }}>
                {searchProgress || 'Please wait while we find related concepts'}
              </div>
            </div>
          )}

          {/* Loading indicator for semantic expansion */}
          {isSearching && expandingNodeId && semanticExpansionResults.length === 0 && (
            <div className="semantic-expansion-loading" style={{ flex: 1, overflow: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
              <div style={{ 
                fontSize: '24px', 
                marginBottom: '8px',
                animation: 'pulse 1.5s ease-in-out infinite'
              }}>
                ⚡
              </div>
              <div style={{ 
                fontSize: '12px', 
                color: '#228B22', 
                fontFamily: "'EmOne', sans-serif", 
                fontWeight: 'bold',
                marginBottom: '4px'
              }}>
                Expanding semantic web...
              </div>
              <div style={{ 
                fontSize: '10px', 
                color: '#666',
                fontFamily: "'EmOne', sans-serif"
              }}>
                Finding related concepts for {nodePrototypesMap.get(expandingNodeId)?.name}
              </div>
            </div>
          )}

          {/* Semantic Expansion Results - Ghost Node Halo */}
          {semanticExpansionResults.length > 0 && expandingNodeId && (
            <div className="semantic-expansion-halo" style={{ flex: 1, overflow: 'auto' }}>
              <div style={{ marginBottom: '12px', fontSize: '12px', color: '#228B22', fontFamily: "'EmOne', sans-serif", fontWeight: 'bold' }}>
                ⭐ Semantic Expansion ({semanticExpansionResults.length} related concepts)
              </div>
              
              {/* Expanding Node Info */}
              <div style={{ 
                marginBottom: '12px', 
                padding: '8px', 
                background: 'rgba(34,139,34,0.1)', 
                borderRadius: '6px',
                border: '1px solid rgba(34,139,34,0.2)'
              }}>
                <div style={{ fontSize: '10px', color: '#228B22', fontFamily: "'EmOne', sans-serif", fontWeight: 'bold' }}>
                  Expanding: {nodePrototypesMap.get(expandingNodeId)?.name || 'Selected Node'}
                </div>
                <div style={{ fontSize: '9px', color: '#666', marginTop: '2px' }}>
                  Drag concepts to canvas or click to add to library
                </div>
              </div>

              {/* Ghost Node Grid */}
              <div style={{ 
                display: 'grid', 
                gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', 
                gap: '8px',
                marginBottom: '12px'
              }}>
                {semanticExpansionResults.map((concept, index) => (
                  <GhostSemanticNode
                    key={concept.id}
                    concept={concept}
                    index={index}
                    onMaterialize={materializeConcept}
                    onSelect={() => {
                      // Auto-materialize on selection
                      materializeConcept(concept);
                    }}
                  />
                ))}
              </div>

              {/* Controls */}
              <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                <button
                  onClick={() => {
                    // Clear expansion results
                    setSemanticExpansionResults([]);
                    setExpandingNodeId(null);
                  }}
                  style={{
                    padding: '6px 12px',
                    border: '1px solid #666',
                    borderRadius: '4px',
                    background: 'transparent',
                    color: '#666',
                    fontSize: '10px',
                    cursor: 'pointer',
                    fontFamily: "'EmOne', sans-serif"
                  }}
                >
                  Clear Expansion
                </button>
                <button
                  onClick={() => {
                    // Materialize all concepts
                    semanticExpansionResults.forEach(concept => materializeConcept(concept));
                    setSemanticExpansionResults([]);
                    setExpandingNodeId(null);
                  }}
                  style={{
                    padding: '6px 12px',
                    border: '1px solid #228B22',
                    borderRadius: '4px',
                    background: '#228B22',
                    color: '#EFE8E5',
                    fontSize: '10px',
                    cursor: 'pointer',
                    fontFamily: "'EmOne', sans-serif",
                    fontWeight: 'bold'
                  }}
                >
                  Add All to Library
                </button>
              </div>
            </div>
          )}
        </>
      )}


      {viewMode === 'history' && (
        <div className="search-history-view" style={{ flex: 1, overflow: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
            <div style={{ fontSize: '12px', color: '#260000', fontFamily: "'EmOne', sans-serif", fontWeight: 'bold' }}>
              Discovery History ({searchHistory.length})
            </div>
            {searchHistory.length > 0 && (
              <button
                title="Clear all history"
                onClick={handleClearHistory}
                style={{
                  background: 'transparent',
                  border: '1px solid #666',
                  color: '#666',
                  width: '18px',
                  height: '18px',
                  lineHeight: 1,
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                ×
              </button>
            )}
          </div>
          {searchHistory.length === 0 ? (
            <div style={{ padding: '20px', textAlign: 'center', color: '#666', fontSize: '11px', fontFamily: "'EmOne', sans-serif" }}>
              No discoveries yet. Open a node and search for related concepts.
            </div>
          ) : (
            searchHistory.map(historyItem => (
              <div key={historyItem.id} style={{
                padding: '8px',
                marginBottom: '8px',
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid #333',
                borderRadius: '6px'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ fontSize: '11px', color: '#260000', fontWeight: 'bold' }}>{historyItem.query}</div>
                  <button
                    title="Remove from history"
                    onClick={() => handleDeleteHistoryItem(historyItem.id)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: '#999',
                      cursor: 'pointer',
                      padding: 0,
                      lineHeight: 1
                    }}
                  >
                    ×
                  </button>
                </div>
                <div style={{ fontSize: '9px', color: '#666', marginTop: '2px' }}>
                  {historyItem.timestamp.toLocaleString()} • {historyItem.resultCount} concepts
                </div>
                <button
                  onClick={() => {
                    setDiscoveredConcepts(historyItem.concepts);
                    setViewMode('discover');
                  }}
                  style={{
                    marginTop: '4px',
                    padding: '2px 6px',
                    border: '1px solid #8B0000',
                    borderRadius: '3px',
                    background: 'transparent',
                    color: '#8B0000',
                    fontSize: '8px',
                    cursor: 'pointer'
                  }}
                >
                  View Results
                </button>
              </div>
            ))
          )}
        </div>
      )}
      </div>
    </>
  );
};

export default LeftSemanticDiscoveryView;
