/**
 * Local Semantic Query Service
 * 
 * Provides semantic querying capabilities within the local Redstring knowledge graph,
 * finding related concepts, entities, and patterns without external CORS issues.
 */

import { findRelatedConcepts } from './semanticWebQuery.js';

// Note: This service uses getState() directly since it's not a React component
// The store will be imported dynamically when needed

export class LocalSemanticQuery {
  constructor() {
    this.semanticPatterns = new Map();
    this.entityCache = new Map();
    this.relationshipCache = new Map();
  }

  /**
   * Find entities related to a search term
   * @param {string} searchTerm - Term to search for
   * @param {Object} options - Search options
   * @returns {Array} Array of related entities
   */
  async findRelatedEntities(searchTerm, options = {}) {
    const {
      maxResults = 20,
      includeTypes = true,
      includeRelationships = true,
      semanticSimilarity = true,
      includeExternal = true
    } = options;

    const results = [];
    const searchLower = searchTerm.toLowerCase();
    
    // Get current graph state dynamically
    const state = await this._getGraphState();
    const { nodePrototypes, graphs, edges } = state;

    // Search through node prototypes
    for (const [nodeId, node] of nodePrototypes) {
      const relevance = this._calculateRelevance(node, searchLower, semanticSimilarity);
      
      if (relevance.score > 0) {
        const entity = {
          id: nodeId,
          name: node.name,
          description: node.description,
          type: node.typeNodeId ? nodePrototypes.get(node.typeNodeId)?.name : null,
          color: node.color,
          relevance: relevance.score,
          matchType: relevance.matchType,
          relationships: includeRelationships ? await this._findRelationships(nodeId, state) : [],
          metadata: {
            created: node.createdAt,
            modified: node.modifiedAt,
            externalLinks: node.externalLinks || []
          }
        };
        
        results.push(entity);
      }
    }

    // Add external semantic web results if enabled
    if (includeExternal) {
      try {
        const externalResults = await findRelatedConcepts(searchTerm, { limit: Math.max(5, maxResults / 4) });
        
        for (const externalItem of externalResults) {
          const entity = {
            id: `external-${externalItem.item?.value || externalItem.resource?.value || Math.random()}`,
            name: externalItem.itemLabel?.value || externalItem.label?.value || 'Unknown',
            description: externalItem.itemDescription?.value || externalItem.comment?.value || '',
            type: 'external',
            color: '#666666',
            relevance: 0.5, // Base relevance for external results
            matchType: 'external',
            relationships: [],
            metadata: {
              source: externalItem.source,
              externalId: externalItem.item?.value || externalItem.resource?.value,
              isExternal: true,
              connectionInfo: externalItem.connectionInfo || null
            }
          };
          
          // Enhance relevance based on connection type
          if (externalItem.connectionInfo) {
            const connectionBoost = {
              'genre': 0.3,
              'developer': 0.4,
              'publisher': 0.3,
              'platform': 0.2,
              'series': 0.5,
              'character': 0.3
            };
            entity.relevance += connectionBoost[externalItem.connectionInfo.type] || 0.1;
            entity.description = `${entity.description} (Related via ${externalItem.connectionInfo.type}: ${externalItem.connectionInfo.value})`;
          }
          
          results.push(entity);
        }
      } catch (error) {
        console.warn('[LocalSemanticQuery] External search failed:', error);
      }
    }

    // Sort by relevance and limit results
    results.sort((a, b) => b.relevance - a.relevance);
    return results.slice(0, maxResults);
  }

  /**
   * Find semantic patterns and clusters
   * @param {string} conceptType - Type of concept to analyze
   * @returns {Object} Pattern analysis results
   */
  async findSemanticPatterns(conceptType = 'all') {
    const state = await this._getGraphState();
    const { nodePrototypes, graphs, edges } = state;
    
    const patterns = {
      entityTypes: new Map(),
      relationshipTypes: new Map(),
      clusters: [],
      semanticGroups: []
    };

    // Analyze entity types
    for (const [nodeId, node] of nodePrototypes) {
      if (node.typeNodeId) {
        const typeNode = nodePrototypes.get(node.typeNodeId);
        if (typeNode) {
          const typeName = typeNode.name;
          if (!patterns.entityTypes.has(typeName)) {
            patterns.entityTypes.set(typeName, []);
          }
          patterns.entityTypes.get(typeName).push({
            id: nodeId,
            name: node.name,
            color: node.color
          });
        }
      }
    }

    // Find semantic clusters
    patterns.clusters = this._findSemanticClusters(nodePrototypes, edges);

    // Group by semantic similarity
    patterns.semanticGroups = this._groupBySemanticSimilarity(nodePrototypes);

    return patterns;
  }

  /**
   * Query for specific entity relationships
   * @param {string} entityId - Entity to find relationships for
   * @param {Object} options - Query options
   * @returns {Object} Relationship data
   */
  async queryEntityRelationships(entityId, options = {}) {
    const {
      includeIncoming = true,
      includeOutgoing = true,
      maxDepth = 2,
      relationshipTypes = []
    } = options;

    const state = await this._getGraphState();
    const { edges, nodePrototypes } = state;
    
    const relationships = {
      incoming: [],
      outgoing: [],
      bidirectional: [],
      paths: []
    };

    // Find direct relationships
    for (const [edgeId, edge] of edges) {
      if (edge.sourceId === entityId && includeOutgoing) {
        const targetNode = nodePrototypes.get(edge.targetId);
        if (targetNode) {
          relationships.outgoing.push({
            id: edgeId,
            target: {
              id: edge.targetId,
              name: targetNode.name,
              type: targetNode.typeNodeId ? nodePrototypes.get(targetNode.typeNodeId)?.name : null,
              color: targetNode.color
            },
            relationship: edge.relationship || 'related to',
            metadata: edge.metadata || {}
          });
        }
      }
      
      if (edge.targetId === entityId && includeIncoming) {
        const sourceNode = nodePrototypes.get(edge.sourceId);
        if (sourceNode) {
          relationships.incoming.push({
            id: edgeId,
            source: {
              id: edge.sourceId,
              name: sourceNode.name,
              type: sourceNode.typeNodeId ? nodePrototypes.get(sourceNode.typeNodeId)?.name : null,
              color: sourceNode.color
            },
            relationship: edge.relationship || 'related to',
            metadata: edge.metadata || {}
          });
        }
      }
    }

    // Find paths (multi-hop relationships)
    if (maxDepth > 1) {
      relationships.paths = this._findPaths(entityId, edges, nodePrototypes, maxDepth);
    }

    return relationships;
  }

  /**
   * Semantic search with context
   * @param {string} query - Search query
   * @param {Object} context - Search context
   * @returns {Array} Search results with context
   */
  async semanticSearch(query, context = {}) {
    const {
      graphId = null,
      nodeTypes = [],
      relationshipTypes = [],
      semanticFilters = []
    } = context;

    // Basic text search
    const textResults = await this.findRelatedEntities(query, {
      maxResults: 50,
      includeTypes: true,
      includeRelationships: true
    });

    // Apply context filters
    let filteredResults = textResults;
    
    if (graphId) {
      const state = await this._getGraphState();
      const graph = state.graphs.get(graphId);
      if (graph && graph.instances) {
        const graphNodeIds = new Set(graph.instances.keys());
        filteredResults = filteredResults.filter(result => 
          graphNodeIds.has(result.id)
        );
      }
    }

    if (nodeTypes.length > 0) {
      filteredResults = filteredResults.filter(result => 
        result.type && nodeTypes.includes(result.type)
      );
    }

    // Add semantic context
    const enrichedResults = await Promise.all(
      filteredResults.map(async (result) => {
        const relationships = await this.queryEntityRelationships(result.id, {
          maxDepth: 1,
          includeIncoming: true,
          includeOutgoing: true
        });
        
        return {
          ...result,
          context: {
            relationshipCount: relationships.incoming.length + relationships.outgoing.length,
            commonTypes: this._findCommonTypes(result.id, relationships),
            semanticNeighbors: this._findSemanticNeighbors(result.id, relationships)
          }
        };
      })
    );

    return enrichedResults;
  }

  /**
   * Calculate relevance score for a node
   * @private
   */
  _calculateRelevance(node, searchTerm, semanticSimilarity = true) {
    let score = 0;
    let matchType = 'none';

    // Exact name match (highest priority)
    if (node.name && node.name.toLowerCase().includes(searchTerm)) {
      score += 100;
      matchType = 'name';
    }

    // Description match
    if (node.description && node.description.toLowerCase().includes(searchTerm)) {
      score += 50;
      matchType = matchType === 'none' ? 'description' : matchType;
    }

    // External link match
    if (node.externalLinks) {
      for (const link of node.externalLinks) {
        if (link.toLowerCase().includes(searchTerm)) {
          score += 30;
          matchType = matchType === 'none' ? 'external_link' : matchType;
          break;
        }
      }
    }

    // Semantic similarity (if enabled)
    if (semanticSimilarity && node.description) {
      const semanticScore = this._calculateSemanticSimilarity(searchTerm, node.description);
      score += semanticScore * 20;
    }

    return { score, matchType };
  }

  /**
   * Calculate semantic similarity between terms
   * @private
   */
  _calculateSemanticSimilarity(term1, term2) {
    // Enhanced semantic similarity with multiple strategies
    
    // 1. Exact match (highest score)
    if (term1.toLowerCase() === term2.toLowerCase()) {
      return 1.0;
    }
    
    // 2. Word overlap similarity
    const words1 = new Set(term1.toLowerCase().split(/\s+/));
    const words2 = new Set(term2.toLowerCase().split(/\s+/));
    
    const intersection = new Set([...words1].filter(x => words2.has(x)));
    const union = new Set([...words1, ...words2]);
    
    const wordOverlap = intersection.size / union.size;
    
    // 3. Substring similarity (for partial matches)
    const longer = term1.length > term2.length ? term1 : term2;
    const shorter = term1.length > term2.length ? term2 : term1;
    const substringScore = longer.toLowerCase().includes(shorter.toLowerCase()) ? 0.8 : 0;
    
    // 4. Acronym/abbreviation similarity
    const acronymScore = this._calculateAcronymSimilarity(term1, term2);
    
    // 5. Category-based similarity (basic heuristics)
    const categoryScore = this._calculateCategorySimilarity(term1, term2);
    
    // Combine scores with weights
    const finalScore = Math.max(
      wordOverlap,
      substringScore,
      acronymScore,
      categoryScore
    );
    
    return finalScore;
  }

  /**
   * Calculate acronym similarity
   * @private
   */
  _calculateAcronymSimilarity(term1, term2) {
    const acronym1 = term1.replace(/[^A-Z]/g, '');
    const acronym2 = term2.replace(/[^A-Z]/g, '');
    
    if (acronym1 && acronym2) {
      if (acronym1 === acronym2) return 0.9;
      if (acronym1.includes(acronym2) || acronym2.includes(acronym1)) return 0.7;
    }
    
    return 0;
  }

  /**
   * Calculate category-based similarity using basic heuristics
   * @private
   */
  _calculateCategorySimilarity(term1, term2) {
    const categories = {
      'game': ['game', 'gaming', 'play', 'player', 'level', 'score', 'character', 'world', 'quest', 'adventure', 'puzzle', 'strategy', 'action', 'rpg', 'fps', 'platform', 'racing', 'sports'],
      'technology': ['tech', 'computer', 'software', 'hardware', 'digital', 'electronic', 'device', 'system', 'platform', 'application', 'program', 'code', 'data', 'network', 'internet', 'web'],
      'media': ['media', 'video', 'audio', 'image', 'picture', 'film', 'movie', 'music', 'book', 'article', 'document', 'content', 'publish', 'stream', 'broadcast'],
      'science': ['science', 'research', 'study', 'experiment', 'theory', 'hypothesis', 'analysis', 'data', 'method', 'discovery', 'innovation', 'technology', 'engineering', 'physics', 'chemistry', 'biology'],
      'business': ['business', 'company', 'corporate', 'enterprise', 'organization', 'industry', 'market', 'commerce', 'trade', 'finance', 'investment', 'management', 'strategy', 'product', 'service']
    };
    
    let maxScore = 0;
    
    for (const [category, keywords] of Object.entries(categories)) {
      const term1InCategory = keywords.some(keyword => 
        term1.toLowerCase().includes(keyword.toLowerCase())
      );
      const term2InCategory = keywords.some(keyword => 
        term2.toLowerCase().includes(keyword.toLowerCase())
      );
      
      if (term1InCategory && term2InCategory) {
        maxScore = Math.max(maxScore, 0.6);
      }
    }
    
    return maxScore;
  }

  /**
   * Find relationships for a node
   * @private
   */
  async _findRelationships(nodeId, state) {
    const { edges, nodePrototypes } = state;
    const relationships = [];

    for (const [edgeId, edge] of edges) {
      if (edge.sourceId === nodeId || edge.targetId === nodeId) {
        const otherId = edge.sourceId === nodeId ? edge.targetId : edge.sourceId;
        const otherNode = nodePrototypes.get(otherId);
        
        if (otherNode) {
          relationships.push({
            id: edgeId,
            target: {
              id: otherId,
              name: otherNode.name,
              type: otherNode.typeNodeId ? nodePrototypes.get(otherNode.typeNodeId)?.name : null
            },
            relationship: edge.relationship || 'related to',
            direction: edge.sourceId === nodeId ? 'outgoing' : 'incoming'
          });
        }
      }
    }

    return relationships;
  }

  /**
   * Find semantic clusters
   * @private
   */
  _findSemanticClusters(nodePrototypes, edges) {
    const clusters = [];
    const visited = new Set();

    for (const [nodeId, node] of nodePrototypes) {
      if (visited.has(nodeId)) continue;

      const cluster = this._expandCluster(nodeId, nodePrototypes, edges, visited);
      if (cluster.nodes.length > 1) {
        clusters.push(cluster);
      }
    }

    return clusters;
  }

  /**
   * Expand a cluster from a seed node
   * @private
   */
  _expandCluster(seedId, nodePrototypes, edges, visited) {
    const cluster = {
      id: `cluster_${seedId}`,
      nodes: [],
      relationships: [],
      center: nodePrototypes.get(seedId)
    };

    const queue = [seedId];
    visited.add(seedId);

    while (queue.length > 0) {
      const currentId = queue.shift();
      const currentNode = nodePrototypes.get(currentId);
      
      if (currentNode) {
        cluster.nodes.push({
          id: currentId,
          name: currentNode.name,
          type: currentNode.typeNodeId ? nodePrototypes.get(currentNode.typeNodeId)?.name : null
        });

        // Find connected nodes
        for (const [edgeId, edge] of edges) {
          if (edge.sourceId === currentId && !visited.has(edge.targetId)) {
            visited.add(edge.targetId);
            queue.push(edge.targetId);
            cluster.relationships.push({
              source: currentId,
              target: edge.targetId,
              type: edge.relationship
            });
          } else if (edge.targetId === currentId && !visited.has(edge.sourceId)) {
            visited.add(edge.sourceId);
            queue.push(edge.sourceId);
            cluster.relationships.push({
              source: edge.sourceId,
              target: currentId,
              type: edge.relationship
            });
          }
        }
      }
    }

    return cluster;
  }

  /**
   * Group nodes by semantic similarity
   * @private
   */
  _groupBySemanticSimilarity(nodePrototypes) {
    const groups = [];
    const processed = new Set();

    for (const [nodeId, node] of nodePrototypes) {
      if (processed.has(nodeId)) continue;

      const group = {
        id: `group_${nodeId}`,
        name: node.name,
        nodes: [node],
        commonTraits: this._extractCommonTraits(node)
      };

      processed.add(nodeId);

      // Find similar nodes
      for (const [otherId, otherNode] of nodePrototypes) {
        if (processed.has(otherId)) continue;

        if (this._areSemanticallySimilar(node, otherNode)) {
          group.nodes.push(otherNode);
          processed.add(otherId);
        }
      }

      if (group.nodes.length > 1) {
        groups.push(group);
      }
    }

    return groups;
  }

  /**
   * Check if two nodes are semantically similar
   * @private
   */
  _areSemanticallySimilar(node1, node2) {
    // Same type
    if (node1.typeNodeId === node2.typeNodeId) return true;
    
    // Similar names
    if (node1.name && node2.name) {
      const similarity = this._calculateSemanticSimilarity(node1.name, node2.name);
      if (similarity > 0.7) return true;
    }
    
    // Similar descriptions
    if (node1.description && node2.description) {
      const similarity = this._calculateSemanticSimilarity(node1.description, node2.description);
      if (similarity > 0.6) return true;
    }
    
    return false;
  }

  /**
   * Extract common traits from a node
   * @private
   */
  _extractCommonTraits(node) {
    const traits = [];
    
    if (node.typeNodeId) traits.push('has_type');
    if (node.description) traits.push('has_description');
    if (node.externalLinks && node.externalLinks.length > 0) traits.push('has_external_links');
    if (node.color) traits.push('has_color');
    
    return traits;
  }

  /**
   * Find paths between entities
   * @private
   */
  _findPaths(startId, edges, nodePrototypes, maxDepth) {
    const paths = [];
    const queue = [{ id: startId, path: [startId], depth: 0 }];
    const visited = new Set([startId]);

    while (queue.length > 0) {
      const current = queue.shift();
      
      if (current.depth >= maxDepth) continue;

      for (const [edgeId, edge] of edges) {
        let nextId = null;
        let direction = null;

        if (edge.sourceId === current.id) {
          nextId = edge.targetId;
          direction = 'outgoing';
        } else if (edge.targetId === current.id) {
          nextId = edge.sourceId;
          direction = 'incoming';
        }

        if (nextId && !visited.has(nextId)) {
          visited.add(nextId);
          const nextNode = nodePrototypes.get(nextId);
          
          if (nextNode) {
            const newPath = {
              path: [...current.path, nextId],
              nodes: current.path.map(id => nodePrototypes.get(id)).concat([nextNode]),
              relationships: current.path.map((id, index) => {
                if (index < current.path.length - 1) {
                  const nextPathId = current.path[index + 1];
                  const edge = Array.from(edges.values()).find(e => 
                    (e.sourceId === id && e.targetId === nextPathId) ||
                    (e.sourceId === nextPathId && e.targetId === id)
                  );
                  return edge ? edge.relationship : 'related to';
                }
                return null;
              }).filter(Boolean),
              depth: current.depth + 1
            };
            
            paths.push(newPath);
            queue.push({ id: nextId, path: newPath.path, depth: newPath.depth });
          }
        }
      }
    }

    return paths;
  }

  /**
   * Get current graph state dynamically
   * @private
   */
  async _getGraphState() {
    try {
      // Dynamic import to avoid circular dependencies
      const graphStoreModule = await import('../store/graphStore.jsx');
      
      // Check if useGraphStore exists and has getState
      if (graphStoreModule.useGraphStore && typeof graphStoreModule.useGraphStore.getState === 'function') {
        return graphStoreModule.useGraphStore.getState();
      }
      
      // Fallback: try to access store directly
      if (graphStoreModule.default && typeof graphStoreModule.default.getState === 'function') {
        return graphStoreModule.default.getState();
      }
      
      console.warn('[LocalSemanticQuery] useGraphStore.getState not available, using fallback');
      return {
        nodePrototypes: new Map(),
        graphs: new Map(),
        edges: new Map()
      };
    } catch (error) {
      console.error('[LocalSemanticQuery] Failed to get graph state:', error);
      // Return empty state as fallback
      return {
        nodePrototypes: new Map(),
        graphs: new Map(),
        edges: new Map()
      };
    }
  }

  /**
   * Find common types in relationships
   * @private
   */
  _findCommonTypes(nodeId, relationships) {
    const typeCounts = new Map();
    
    for (const rel of relationships.incoming.concat(relationships.outgoing)) {
      const otherNode = rel.source || rel.target;
      if (otherNode && otherNode.type) {
        typeCounts.set(otherNode.type, (typeCounts.get(otherNode.type) || 0) + 1);
      }
    }
    
    return Array.from(typeCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([type, count]) => ({ type, count }));
  }

  /**
   * Find semantic neighbors
   * @private
   */
  _findSemanticNeighbors(nodeId, relationships) {
    const neighbors = [];
    
    for (const rel of relationships.incoming.concat(relationships.outgoing)) {
      const otherNode = rel.source || rel.target;
      if (otherNode) {
        neighbors.push({
          id: otherNode.id,
          name: otherNode.name,
          type: otherNode.type,
          relationship: rel.relationship
        });
      }
    }
    
    return neighbors;
  }
}

// Export singleton instance
export const localSemanticQuery = new LocalSemanticQuery();

// Export convenience functions
export const findRelatedEntities = (searchTerm, options) => 
  localSemanticQuery.findRelatedEntities(searchTerm, options);

export const findSemanticPatterns = (conceptType) => 
  localSemanticQuery.findSemanticPatterns(conceptType);

export const queryEntityRelationships = (entityId, options) => 
  localSemanticQuery.queryEntityRelationships(entityId, options);

export const semanticSearch = (query, context) => 
  localSemanticQuery.semanticSearch(query, context);
