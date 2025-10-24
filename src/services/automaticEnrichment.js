/**
 * Automatic Semantic Enrichment Service
 * 
 * Automatically enriches nodes with semantic web data based on their titles.
 * Pulls in rich information from external sources without manual intervention.
 */

import { rdfResolver } from './rdfResolver.js';
import { sparqlClient } from './sparqlClient.js';
import { localSemanticQuery } from './localSemanticQuery.js';

export class AutomaticEnrichment {
  constructor() {
    this.enrichmentQueue = [];
    this.isProcessing = false;
    this.enrichmentCache = new Map();
    this.CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
    this.enrichmentSources = [
      'wikidata',
      'dbpedia', 
      'schema.org',
      'local_knowledge'
    ];
  }

  /**
   * Automatically enrich a node based on its title
   * @param {Object} nodeData - Node to enrich
   * @param {Object} options - Enrichment options
   * @returns {Promise<Object>} Enrichment results
   */
  async enrichNode(nodeData, options = {}) {
    const {
      forceRefresh = false,
      includeExternalData = true,
      includeLocalConnections = true,
      maxResults = 10
    } = options;

    if (!nodeData || !nodeData.name) {
      throw new Error('Node must have a name for automatic enrichment');
    }

    const nodeTitle = nodeData.name.trim();
    const cacheKey = `enrich_${nodeTitle.toLowerCase()}`;

    // Check cache first
    if (!forceRefresh && this.enrichmentCache.has(cacheKey)) {
      const cached = this.enrichmentCache.get(cacheKey);
      if (Date.now() - cached.timestamp < this.CACHE_TTL) {
        console.log(`[Auto Enrichment] Using cached data for: ${nodeTitle}`);
        return cached.data;
      }
    }

    console.log(`[Auto Enrichment] Starting enrichment for: ${nodeTitle}`);

    const enrichmentResults = {
      nodeTitle,
      enrichedAt: new Date().toISOString(),
      sources: {},
      suggestions: [],
      externalData: [],
      localConnections: [],
      summary: {
        totalSources: 0,
        totalSuggestions: 0,
        totalExternalData: 0,
        totalLocalConnections: 0
      }
    };

    try {
      // 1. Query Wikidata for entity information
      if (includeExternalData) {
        try {
          const wikidataResults = await this._queryWikidata(nodeTitle);
          enrichmentResults.sources.wikidata = wikidataResults;
          enrichmentResults.totalSources++;
          
          if (wikidataResults.success && wikidataResults.entities && wikidataResults.entities.length > 0) {
            enrichmentResults.externalData.push(...wikidataResults.entities);
            enrichmentResults.totalExternalData += wikidataResults.entities.length;
          }
        } catch (error) {
          console.warn(`[Auto Enrichment] Wikidata query failed for ${nodeTitle}:`, error.message);
        }
      }

      // 2. Query DBpedia for additional context
      if (includeExternalData) {
        try {
          const dbpediaResults = await this._queryDBpedia(nodeTitle);
          enrichmentResults.sources.dbpedia = dbpediaResults;
          enrichmentResults.totalSources++;
          
          if (dbpediaResults.success && dbpediaResults.entities && dbpediaResults.entities.length > 0) {
            enrichmentResults.externalData.push(...dbpediaResults.entities);
            enrichmentResults.totalExternalData += dbpediaResults.entities.length;
          }
        } catch (error) {
          console.warn(`[Auto Enrichment] DBpedia query failed for ${nodeTitle}:`, error.message);
        }
      }

      // 3. Query Schema.org for type information
      if (includeExternalData) {
        try {
          const schemaResults = await this._querySchemaOrg(nodeTitle);
          enrichmentResults.sources.schema = schemaResults;
          enrichmentResults.totalSources++;
          
          if (schemaResults.types && schemaResults.types.length > 0) {
            enrichmentResults.suggestions.push(...schemaResults.types.map(type => ({
              type: 'schema_type',
              label: type.label,
              uri: type.uri,
              description: type.description,
              confidence: 0.8
            })));
            enrichmentResults.totalSuggestions += schemaResults.types.length;
          }
        } catch (error) {
          console.warn(`[Auto Enrichment] Schema.org query failed for ${nodeTitle}:`, error.message);
        }
      }

      // 4. Find local knowledge graph connections
      if (includeLocalConnections) {
        try {
          const localResults = await this._queryLocalKnowledge(nodeTitle);
          enrichmentResults.sources.local = localResults;
          enrichmentResults.totalSources++;
          
          if (localResults.success && localResults.relatedEntities && localResults.relatedEntities.length > 0) {
            enrichmentResults.localConnections.push(...localResults.relatedEntities);
            enrichmentResults.totalLocalConnections += localResults.relatedEntities.length;
          }
        } catch (error) {
          console.warn(`[Auto Enrichment] Local knowledge query failed for ${nodeTitle}:`, error.message);
        }
      }

      // 5. Generate intelligent suggestions
      enrichmentResults.suggestions.push(...this._generateIntelligentSuggestions(nodeTitle, enrichmentResults));

      // 6. If external sources failed but we have local data, still provide value
      if (enrichmentResults.totalExternalData === 0 && enrichmentResults.totalLocalConnections > 0) {
        console.log(`[Auto Enrichment] External sources failed, but found ${enrichmentResults.totalLocalConnections} local connections for ${nodeTitle}`);
        enrichmentResults.summary.fallbackMode = true;
      }

      // 7. Ensure we always have valid results even if queries failed
      if (enrichmentResults.totalExternalData === 0 && enrichmentResults.totalLocalConnections === 0) {
        // Generate basic suggestions based on the node title
        enrichmentResults.suggestions.push({
          type: 'basic_suggestion',
          label: `Search for "${nodeTitle}" in external sources`,
          uri: `search:${nodeTitle}`,
          description: `No external data found, but you can manually search for "${nodeTitle}" in Wikidata, DBpedia, or other sources.`,
          confidence: 0.5
        });
        enrichmentResults.totalSuggestions = 1;
        
        console.log(`[Auto Enrichment] No external or local data found for ${nodeTitle}, providing basic suggestions`);
      }

      // 8. Cache the results
      this.enrichmentCache.set(cacheKey, {
        data: enrichmentResults,
        timestamp: Date.now()
      });

      console.log(`[Auto Enrichment] Completed enrichment for ${nodeTitle}:`, {
        sources: enrichmentResults.totalSources,
        externalData: enrichmentResults.totalExternalData,
        localConnections: enrichmentResults.totalLocalConnections,
        suggestions: enrichmentResults.totalSuggestions,
        fallbackMode: enrichmentResults.summary.fallbackMode || false
      });

      return enrichmentResults;

    } catch (error) {
      console.error(`[Auto Enrichment] Failed to enrich node ${nodeTitle}:`, error);
      throw new Error(`Automatic enrichment failed: ${error.message}`);
    }
  }

  /**
   * Query Wikidata for entity information
   * @private
   */
  async _queryWikidata(searchTerm) {
    try {
      // Search for entities - simplified query for better performance
      const searchQuery = `
        SELECT DISTINCT ?entity ?entityLabel ?entityDescription WHERE {
          ?entity rdfs:label ?entityLabel .
          OPTIONAL { ?entity schema:description ?entityDescription }
          
          FILTER(CONTAINS(LCASE(?entityLabel), LCASE("${searchTerm}")) || 
                 (BOUND(?entityDescription) && CONTAINS(LCASE(?entityDescription), LCASE("${searchTerm}"))))
          
          FILTER(LANG(?entityLabel) = "en")
          FILTER(LANG(?entityDescription) = "en")
        }
        LIMIT 5
      `;

      // Add timeout to prevent hanging
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Query timeout')), 10000)
      );

      const queryPromise = sparqlClient.executeQuery('wikidata', searchQuery);
      const results = await Promise.race([queryPromise, timeoutPromise]);
      
      if (results && results.results && results.results.bindings) {
        const entities = results.results.bindings.map(binding => ({
          id: binding.entity?.value,
          label: binding.entityLabel?.value,
          description: binding.entityDescription?.value,
          type: 'Entity', // Default type since we're not querying types anymore
          typeUri: null,
          source: 'wikidata',
          confidence: this._calculateConfidence(searchTerm, binding.entityLabel?.value || '')
        }));

        return {
          success: true,
          entities: entities.sort((a, b) => b.confidence - a.confidence),
          query: searchQuery
        };
      }

      return { success: false, entities: [], error: 'No results found' };

    } catch (error) {
      console.warn(`[Auto Enrichment] Wikidata query failed for "${searchTerm}":`, error.message);
      return { success: false, entities: [], error: error.message };
    }
  }

  /**
   * Query DBpedia for additional context
   * @private
   */
  async _queryDBpedia(searchTerm) {
    // Validate input to prevent malformed SPARQL queries
    if (!searchTerm || typeof searchTerm !== 'string' || searchTerm.trim() === '') {
      console.warn('[Auto Enrichment] Invalid searchTerm for DBpedia query:', searchTerm);
      return { success: false, entities: [], error: 'Invalid search term' };
    }

    const sanitizedSearchTerm = searchTerm.trim();
    
    try {
      // Search for entities - simplified query for better performance
      const searchQuery = `
        SELECT DISTINCT ?entity ?entityLabel ?entityAbstract WHERE {
          ?entity rdfs:label ?entityLabel .
          OPTIONAL { ?entity dbo:abstract ?entityAbstract }
          
          FILTER(CONTAINS(LCASE(?entityLabel), LCASE("${sanitizedSearchTerm}")) || 
                 (BOUND(?entityAbstract) && CONTAINS(LCASE(?entityAbstract), LCASE("${sanitizedSearchTerm}"))))
          
          FILTER(LANG(?entityLabel) = "en")
          FILTER(LANG(?entityAbstract) = "en")
        }
        LIMIT 5
      `;

      // Add timeout to prevent hanging
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Query timeout')), 10000)
      );

      const queryPromise = sparqlClient.executeQuery('dbpedia', searchQuery);
      const results = await Promise.race([queryPromise, timeoutPromise]);
      
      if (results && results.results && results.results.bindings) {
        const entities = results.results.bindings.map(binding => ({
          id: binding.entity?.value,
          label: binding.entityLabel?.value,
          description: binding.entityAbstract?.value,
          type: 'Entity', // Default type since we're not querying types anymore
          typeUri: null,
          source: 'dbpedia',
          confidence: this._calculateConfidence(searchTerm, binding.entityLabel?.value || '')
        }));

        return {
          success: true,
          entities: entities.sort((a, b) => a.confidence - b.confidence),
          query: searchQuery
        };
      }

      return { success: false, entities: [], error: 'No results found' };

    } catch (error) {
      console.warn(`[Auto Enrichment] DBpedia query failed for "${searchTerm}":`, error.message);
      return { success: false, entities: [], error: error.message };
    }
  }

  /**
   * Query Schema.org for type information
   * @private
   */
  async _querySchemaOrg(searchTerm) {
    try {
      // Common Schema.org types that might match
      const commonTypes = [
        { uri: 'http://schema.org/Organization', label: 'Organization', description: 'A business, government agency, or other organization' },
        { uri: 'http://schema.org/Corporation', label: 'Corporation', description: 'A corporation' },
        { uri: 'http://schema.org/Company', label: 'Company', description: 'A company or business' },
        { uri: 'http://schema.org/SoftwareApplication', label: 'Software Application', description: 'A software application' },
        { uri: 'http://schema.org/Game', label: 'Game', description: 'A video game or other game' },
        { uri: 'http://schema.org/CreativeWork', label: 'Creative Work', description: 'A creative work like a book, movie, or game' },
        { uri: 'http://schema.org/Product', label: 'Product', description: 'A product or service' },
        { uri: 'http://schema.org/Place', label: 'Place', description: 'A physical location' },
        { uri: 'http://schema.org/Person', label: 'Person', description: 'An individual person' }
      ];

      // Filter types based on search term relevance
      const relevantTypes = commonTypes.filter(type => {
        const searchLower = searchTerm.toLowerCase();
        return type.label.toLowerCase().includes(searchLower) ||
               type.description.toLowerCase().includes(searchLower);
      });

      return {
        success: true,
        types: relevantTypes.map(type => ({
          ...type,
          confidence: this._calculateConfidence(searchTerm, type.label)
        })).sort((a, b) => b.confidence - a.confidence)
      };

    } catch (error) {
      return { success: false, types: [], error: error.message };
    }
  }

  /**
   * Query local knowledge graph for connections
   * @private
   */
  async _queryLocalKnowledge(searchTerm) {
    try {
      const relatedEntities = await localSemanticQuery.findRelatedEntities(searchTerm, {
        maxResults: 15,
        includeTypes: true,
        includeRelationships: true,
        semanticSimilarity: true
      });

      return {
        success: true,
        relatedEntities: relatedEntities.map(entity => ({
          id: entity.id,
          name: entity.name,
          description: entity.description,
          type: entity.type,
          color: entity.color,
          relevance: entity.relevance,
          relationships: entity.relationships.length,
          source: 'local_knowledge'
        }))
      };

    } catch (error) {
      return { success: false, relatedEntities: [], error: error.message };
    }
  }

  /**
   * Generate intelligent suggestions based on enrichment results
   * @private
   */
  _generateIntelligentSuggestions(nodeTitle, enrichmentResults) {
    const suggestions = [];

    // Suggest external links based on found entities
    if (enrichmentResults.externalData.length > 0) {
      enrichmentResults.externalData.forEach(entity => {
        if (entity.id && entity.confidence > 0.7) {
          suggestions.push({
            type: 'external_link',
            label: `Link to ${entity.source} entity`,
            uri: entity.id,
            description: `Connect to ${entity.label} in ${entity.source}`,
            confidence: entity.confidence,
            metadata: {
              source: entity.source,
              entityType: entity.type,
              entityLabel: entity.label
            }
          });
        }
      });
    }

    // Suggest type assignments based on found entities
    if (enrichmentResults.externalData.length > 0) {
      const typeCounts = new Map();
      enrichmentResults.externalData.forEach(entity => {
        if (entity.type) {
          typeCounts.set(entity.type, (typeCounts.get(entity.type) || 0) + 1);
        }
      });

      Array.from(typeCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .forEach(([type, count]) => {
          suggestions.push({
            type: 'type_assignment',
            label: `Assign type: ${type}`,
            uri: `local:${type.replace(/\s+/g, '')}`,
            description: `This entity appears to be a ${type} based on ${count} external sources`,
            confidence: Math.min(0.9, 0.5 + (count * 0.1)),
            metadata: {
              suggestedType: type,
              sourceCount: count
            }
          });
        });
    }

    // Suggest local connections
    if (enrichmentResults.localConnections.length > 0) {
      enrichmentResults.localConnections
        .filter(conn => conn.relevance > 0.6)
        .slice(0, 5)
        .forEach(conn => {
          suggestions.push({
            type: 'local_connection',
            label: `Connect to: ${conn.name}`,
            uri: `local:${conn.id}`,
            description: `This entity is related to ${conn.name} (${conn.type})`,
            confidence: conn.relevance / 100,
            metadata: {
              targetEntity: conn.name,
              targetType: conn.type,
              relationshipType: 'related_to'
            }
          });
        });
    }

    return suggestions;
  }

  /**
   * Calculate confidence score for a match
   * @private
   */
  _calculateConfidence(searchTerm, targetText) {
    if (!searchTerm || !targetText) return 0;
    
    const searchLower = searchTerm.toLowerCase();
    const targetLower = targetText.toLowerCase();
    
    // Exact match
    if (searchLower === targetLower) return 1.0;
    
    // Contains match
    if (targetLower.includes(searchLower)) return 0.9;
    
    // Word overlap
    const searchWords = new Set(searchLower.split(/\s+/));
    const targetWords = new Set(targetLower.split(/\s+/));
    const intersection = new Set([...searchWords].filter(x => targetWords.has(x)));
    const union = new Set([...searchWords, ...targetWords]);
    
    if (union.size === 0) return 0;
    return intersection.size / union.size;
  }

  /**
   * Get enrichment cache statistics
   * @returns {Object} Cache statistics
   */
  getCacheStats() {
    const now = Date.now();
    let validEntries = 0;
    let expiredEntries = 0;
    
    for (const [key, value] of this.enrichmentCache.entries()) {
      if (now - value.timestamp < this.CACHE_TTL) {
        validEntries++;
      } else {
        expiredEntries++;
      }
    }
    
    return {
      totalEntries: this.enrichmentCache.size,
      validEntries,
      expiredEntries,
      cacheSize: `${(this.enrichmentCache.size * 0.001).toFixed(2)} MB`
    };
  }

  /**
   * Clear enrichment cache
   * @param {string} nodeTitle - Optional specific node to clear
   */
  clearCache(nodeTitle = null) {
    if (nodeTitle) {
      const cacheKey = `enrich_${nodeTitle.toLowerCase()}`;
      this.enrichmentCache.delete(cacheKey);
    } else {
      this.enrichmentCache.clear();
    }
  }
}

// Export singleton instance
export const automaticEnrichment = new AutomaticEnrichment();

// Export convenience functions
export const enrichNode = (nodeData, options) => 
  automaticEnrichment.enrichNode(nodeData, options);

export const getEnrichmentCacheStats = () => 
  automaticEnrichment.getCacheStats();

export const clearEnrichmentCache = (nodeTitle) => 
  automaticEnrichment.clearCache(nodeTitle);
