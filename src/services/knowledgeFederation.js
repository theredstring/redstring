/**
 * Knowledge Federation Service
 * 
 * Connects to multiple knowledge bases simultaneously, imports related entities,
 * and creates federated search across domains
 */

import { enrichFromSemanticWeb } from './semanticWebQuery.js';
import { sparqlClient } from './sparqlClient.js';

export class KnowledgeFederation {
  constructor(graphStore) {
    this.graphStore = graphStore;
    this.federatedSources = new Map([
      ['wikidata', {
        name: 'Wikidata',
        endpoint: 'https://query.wikidata.org/sparql',
        queryFn: this.queryWikidata.bind(this),
        relationshipFn: this.getWikidataRelationships.bind(this)
      }],
      ['dbpedia', {
        name: 'DBpedia', 
        endpoint: 'https://dbpedia.org/sparql',
        queryFn: this.queryDBpedia.bind(this),
        relationshipFn: this.getDBpediaRelationships.bind(this)
      }],
      ['conceptnet', {
        name: 'ConceptNet',
        endpoint: '/api/conceptnet',
        queryFn: this.queryConceptNet.bind(this),
        relationshipFn: this.getConceptNetRelationships.bind(this)
      }]
    ]);
    
    this.importQueue = [];
    this.isImporting = false;
    this.importCache = new Map();
  }

  /**
   * Import a knowledge cluster around a seed entity
   * @param {string} seedEntity - Starting entity name
   * @param {Object} options - Import options
   * @returns {Promise<Object>} Import results
   */
  async importKnowledgeCluster(seedEntity, options = {}) {
    const {
      maxDepth = 2,
      maxEntitiesPerLevel = 10,
      includeRelationships = true,
      includeSources = ['wikidata', 'dbpedia'],
      onProgress = () => {}
    } = options;

    // Validate input to prevent processing empty entities
    if (!seedEntity || typeof seedEntity !== 'string' || seedEntity.trim() === '') {
      console.warn('[KnowledgeFederation] importKnowledgeCluster called with invalid seedEntity:', {
        seedEntity,
        type: typeof seedEntity,
        options
      });
      return {
        seedEntity: seedEntity || 'Unknown',
        totalEntities: 0,
        totalRelationships: 0,
        sourceBreakdown: {},
        entities: new Map(),
        relationships: [],
        clusters: new Map(),
        importedAt: new Date().toISOString(),
        error: 'Invalid seed entity provided'
      };
    }

    const sanitizedSeedEntity = seedEntity.trim();
    
    const results = {
      seedEntity: sanitizedSeedEntity,
      totalEntities: 0,
      totalRelationships: 0,
      sourceBreakdown: {},
      entities: new Map(),
      relationships: [],
      clusters: new Map(),
      importedAt: new Date().toISOString()
    };

    try {
      // Level 0: Import seed entity
      onProgress({ stage: 'seed', entity: sanitizedSeedEntity, level: 0 });
      const seedData = await this.importSingleEntity(sanitizedSeedEntity, includeSources);
      results.entities.set(sanitizedSeedEntity, seedData);
      
      // Level 1+: Import related entities
      let currentEntities = [sanitizedSeedEntity];
      
      for (let depth = 1; depth <= maxDepth; depth++) {
        const nextLevelEntities = [];
        
        for (const entity of currentEntities.slice(0, maxEntitiesPerLevel)) {
          onProgress({ stage: 'relationships', entity, level: depth });
          
          const relationships = await this.findRelatedEntities(entity, {
            sources: includeSources,
            limit: Math.floor(maxEntitiesPerLevel / currentEntities.length)
          });
          
          for (const rel of relationships) {
            // Import related entity if not already imported
            if (!results.entities.has(rel.target)) {
              onProgress({ stage: 'entity', entity: rel.target, level: depth });
              const entityData = await this.importSingleEntity(rel.target, includeSources);
              results.entities.set(rel.target, entityData);
              nextLevelEntities.push(rel.target);
            }
            
            // Add relationship
            results.relationships.push({
              source: entity,
              target: rel.target,
              relation: rel.relation,
              confidence: rel.confidence,
              sources: rel.sources
            });
          }
        }
        
        currentEntities = nextLevelEntities;
        if (currentEntities.length === 0) break;
      }

      // Generate statistics
      results.totalEntities = results.entities.size;
      results.totalRelationships = results.relationships.length;
      
      for (const [entityId, entityData] of results.entities) {
        for (const source of entityData.sources) {
          results.sourceBreakdown[source] = (results.sourceBreakdown[source] || 0) + 1;
        }
      }

      // Create clusters based on relationship density
      results.clusters = this.identifyClusters(results.entities, results.relationships);

      console.log(`[KnowledgeFederation] Imported ${results.totalEntities} entities with ${results.totalRelationships} relationships`);
      
      return results;

    } catch (error) {
      console.error('[KnowledgeFederation] Import failed:', error);
      throw error;
    }
  }

  /**
   * Import a single entity from federated knowledge sources
   */
  async importSingleEntity(entityName, sources = ['wikidata', 'dbpedia']) {
    // Add debug logging to track where empty entity names come from
    if (!entityName || typeof entityName !== 'string' || entityName.trim() === '') {
      console.warn('[KnowledgeFederation] importSingleEntity called with invalid entityName:', {
        entityName,
        type: typeof entityName,
        sources,
        stack: new Error().stack
      });
      return {
        name: entityName || 'Unknown',
        sources: [],
        descriptions: [],
        externalLinks: [],
        types: [],
        properties: new Map(),
        confidence: 0
      };
    }

    const sanitizedEntityName = entityName.trim();
    const cacheKey = `${sanitizedEntityName}:${sources.join(',')}`;
    
    if (this.importCache.has(cacheKey)) {
      return this.importCache.get(cacheKey);
    }

    const entityData = {
      name: sanitizedEntityName,
      sources: [],
      descriptions: [],
      externalLinks: [],
      types: [],
      properties: new Map(),
      confidence: 0
    };

    // Query each source
    for (const sourceName of sources) {
      const source = this.federatedSources.get(sourceName);
      if (!source) continue;

      try {
        const sourceResults = await source.queryFn(sanitizedEntityName);
        if (sourceResults.length > 0) {
          entityData.sources.push(sourceName);
          
          // Merge results
          for (const result of sourceResults) {
            if (result.description) {
              entityData.descriptions.push({
                text: result.description,
                source: sourceName,
                confidence: result.confidence || 0.8
              });
            }
            
            if (result.uri) {
              entityData.externalLinks.push(result.uri);
            }
            
            if (result.types) {
              entityData.types.push(...result.types.map(type => ({
                type,
                source: sourceName
              })));
            }
            
            if (result.properties) {
              for (const [key, value] of Object.entries(result.properties)) {
                if (!entityData.properties.has(key)) {
                  entityData.properties.set(key, []);
                }
                entityData.properties.get(key).push({
                  value,
                  source: sourceName
                });
              }
            }
          }
          
          entityData.confidence = Math.max(entityData.confidence, sourceResults[0].confidence || 0.8);
        }
      } catch (error) {
        console.warn(`[KnowledgeFederation] Failed to query ${sourceName} for ${sanitizedEntityName}:`, error);
      }
    }

    // Cache the result
    this.importCache.set(cacheKey, entityData);
    return entityData;
  }

  /**
   * Find entities related to a seed entity
   * @param {string} seedEntity - Entity to find relationships for
   * @param {Object} options - Search options
   * @returns {Promise<Array>} Related entities
   */
  async findRelatedEntities(seedEntity, options = {}) {
    const { sources = ['wikidata', 'dbpedia'], limit = 10 } = options;
    
    // Validate input to prevent processing empty entities
    if (!seedEntity || typeof seedEntity !== 'string' || seedEntity.trim() === '') {
      console.warn('[KnowledgeFederation] findRelatedEntities called with invalid seedEntity:', {
        seedEntity,
        type: typeof seedEntity,
        options
      });
      return [];
    }

    const sanitizedSeedEntity = seedEntity.trim();
    const relationships = [];

    for (const sourceName of sources) {
      const source = this.federatedSources.get(sourceName);
      if (!source) continue;

      try {
        const sourceRelationships = await source.relationshipFn(sanitizedSeedEntity, { limit: Math.floor(limit / sources.length) });
        relationships.push(...sourceRelationships.map(rel => ({
          ...rel,
          sources: [sourceName]
        })));
      } catch (error) {
        console.warn(`[KnowledgeFederation] Failed to get relationships from ${sourceName}:`, error);
      }
    }

    // Sort by confidence and remove duplicates
    return relationships
      .sort((a, b) => (b.confidence || 0) - (a.confidence || 0))
      .slice(0, limit)
      .filter((rel, index, arr) => 
        arr.findIndex(r => r.target === rel.target) === index
      );
  }

  /**
   * Federated search across all knowledge sources
   * @param {string} query - Search query
   * @param {Object} options - Search options
   * @returns {Promise<Array>} Search results
   */
  async federatedSearch(query, options = {}) {
    const { 
      sources = Array.from(this.federatedSources.keys()),
      limit = 20,
      minConfidence = 0.5,
      includeSnippets = true
    } = options;

    // Validate input to prevent processing empty queries
    if (!query || typeof query !== 'string' || query.trim() === '') {
      console.warn('[KnowledgeFederation] federatedSearch called with invalid query:', {
        query,
        type: typeof query,
        options
      });
      return [];
    }

    const sanitizedQuery = query.trim();
    const results = [];
    const searchPromises = [];

    // Search each source in parallel
    for (const sourceName of sources) {
      const source = this.federatedSources.get(sourceName);
      if (!source) continue;

      searchPromises.push(
        this.searchSingleSource(sourceName, query, { 
          limit: Math.floor(limit / sources.length),
          includeSnippets 
        }).then(sourceResults => 
          sourceResults.map(result => ({ ...result, source: sourceName }))
        ).catch(error => {
          console.warn(`[KnowledgeFederation] Search failed for ${sourceName}:`, error);
          return [];
        })
      );
    }

    // Collect all results
    const allResults = await Promise.all(searchPromises);
    for (const sourceResults of allResults) {
      results.push(...sourceResults);
    }

    // Rank and deduplicate results
    return results
      .filter(result => (result.confidence || 0) >= minConfidence)
      .sort((a, b) => (b.confidence || 0) - (a.confidence || 0))
      .slice(0, limit);
  }

  /**
   * Search a single knowledge source
   * @param {string} sourceName - Source to search
   * @param {string} query - Search query
   * @param {Object} options - Search options
   * @returns {Promise<Array>} Search results
   */
  async searchSingleSource(sourceName, query, options = {}) {
    const { limit = 10, includeSnippets = true } = options;
    
    // Validate input to prevent processing empty queries
    if (!query || typeof query !== 'string' || query.trim() === '') {
      console.warn('[KnowledgeFederation] searchSingleSource called with invalid query:', {
        sourceName,
        query,
        type: typeof query,
        options
      });
      return [];
    }

    const sanitizedQuery = query.trim();
    
    if (sourceName === 'wikidata') {
      return await this.searchWikidata(sanitizedQuery, { limit, includeSnippets });
    } else if (sourceName === 'dbpedia') {
      return await this.searchDBpedia(sanitizedQuery, { limit, includeSnippets });
    } else if (sourceName === 'conceptnet') {
      return await this.searchConceptNet(sanitizedQuery, { limit, includeSnippets });
    }
    
    return [];
  }

  // Source-specific query methods

  /**
   * Query Wikidata for entity
   */
  async queryWikidata(entityName) {
    // Validate input to prevent malformed SPARQL queries
    if (!entityName || typeof entityName !== 'string' || entityName.trim() === '') {
      console.warn('[KnowledgeFederation] Invalid entityName for Wikidata query:', entityName);
      return [];
    }

    const sanitizedEntityName = entityName.trim();
    
    const query = `
      SELECT DISTINCT ?item ?itemLabel ?itemDescription ?instanceOf ?instanceOfLabel WHERE {
        ?item rdfs:label "${sanitizedEntityName}"@en .
        OPTIONAL { ?item wdt:P31 ?instanceOf }
        SERVICE wikibase:label { bd:serviceParam wikibase:language "en" }
      } LIMIT 5
    `;
    
    try {
      const results = await sparqlClient.executeQuery('wikidata', query);
      return results.map(result => ({
        uri: result.item?.value,
        description: result.itemDescription?.value,
        types: result.instanceOf ? [result.instanceOfLabel?.value || result.instanceOf.value] : [],
        confidence: 0.9,
        properties: {}
      }));
    } catch (error) {
      return [];
    }
  }

  /**
   * Get Wikidata relationships for entity
   */
  async getWikidataRelationships(entityName, options = {}) {
    const { limit = 10 } = options;
    
    // Validate input to prevent malformed SPARQL queries
    if (!entityName || typeof entityName !== 'string' || entityName.trim() === '') {
      console.warn('[KnowledgeFederation] Invalid entityName for Wikidata relationships query:', entityName);
      return [];
    }

    const sanitizedEntityName = entityName.trim();
    
    const query = `
      SELECT DISTINCT ?related ?relatedLabel ?property ?propertyLabel WHERE {
        ?item rdfs:label "${sanitizedEntityName}"@en .
        ?item ?property ?related .
        ?related rdfs:label ?relatedLabel .
        FILTER(LANG(?relatedLabel) = "en")
        FILTER(?property != rdfs:label)
        SERVICE wikibase:label { bd:serviceParam wikibase:language "en" }
      } LIMIT ${limit}
    `;
    
    try {
      const results = await sparqlClient.executeQuery('wikidata', query);
      return results.map(result => ({
        target: result.relatedLabel?.value,
        relation: result.propertyLabel?.value || 'related_to',
        confidence: 0.8
      }));
    } catch (error) {
      return [];
    }
  }

  /**
   * Query DBpedia for entity
   */
  async queryDBpedia(entityName) {
    // Validate input to prevent malformed SPARQL queries
    if (!entityName || typeof entityName !== 'string' || entityName.trim() === '') {
      console.warn('[KnowledgeFederation] Invalid entityName for DBpedia query:', entityName);
      return [];
    }

    const sanitizedEntityName = entityName.trim();
    
    const query = `
      SELECT DISTINCT ?resource ?comment ?type WHERE {
        ?resource rdfs:label "${sanitizedEntityName}"@en .
        OPTIONAL { ?resource rdfs:comment ?comment . FILTER(LANG(?comment) = "en") }
        OPTIONAL { ?resource rdf:type ?type }
      } LIMIT 5
    `;
    
    try {
      const results = await sparqlClient.executeQuery('dbpedia', query);
      return results.map(result => ({
        uri: result.resource?.value,
        description: result.comment?.value,
        types: result.type ? [result.type.value] : [],
        confidence: 0.8,
        properties: {}
      }));
    } catch (error) {
      return [];
    }
  }

  /**
   * Get DBpedia relationships for entity
   */
  async getDBpediaRelationships(entityName, options = {}) {
    const { limit = 10 } = options;
    
    // Validate input to prevent malformed SPARQL queries
    if (!entityName || typeof entityName !== 'string' || entityName.trim() === '') {
      console.warn('[KnowledgeFederation] Invalid entityName for DBpedia relationships query:', entityName);
      return [];
    }

    const sanitizedEntityName = entityName.trim();
    
    const query = `
      SELECT DISTINCT ?related ?relatedLabel ?property WHERE {
        ?resource rdfs:label "${sanitizedEntityName}"@en .
        ?resource ?property ?related .
        ?related rdfs:label ?relatedLabel .
        FILTER(LANG(?relatedLabel) = "en")
        FILTER(?property != rdfs:label && ?property != rdfs:comment)
      } LIMIT ${limit}
    `;
    
    try {
      const results = await sparqlClient.executeQuery('dbpedia', query);
      return results.map(result => ({
        target: result.relatedLabel?.value,
        relation: this.simplifyDBpediaProperty(result.property?.value) || 'related_to',
        confidence: 0.7
      }));
    } catch (error) {
      return [];
    }
  }

  /**
   * Query ConceptNet (REST API)
   */
  async queryConceptNet(entityName) {
    try {
      const response = await fetch(`/api/conceptnet/c/en/${entityName.toLowerCase().replace(/\s+/g, '_')}?limit=10`);
      if (!response.ok) return [];
      
      const data = await response.json();
      return [{
        uri: data['@id'],
        description: `ConceptNet concept: ${entityName}`,
        types: ['concept'],
        confidence: 0.7,
        properties: {}
      }];
    } catch (error) {
      return [];
    }
  }

  /**
   * Get ConceptNet relationships
   */
  async getConceptNetRelationships(entityName, options = {}) {
    const { limit = 10 } = options;
    
    try {
      const response = await fetch(`/api/conceptnet/query?node=/c/en/${entityName.toLowerCase().replace(/\s+/g, '_')}&limit=${limit}`);
      if (!response.ok) return [];
      
      const data = await response.json();
      return data.edges.map(edge => ({
        target: this.extractConceptNetLabel(edge.end),
        relation: edge.rel?.label || 'related_to',
        confidence: edge.weight || 0.5
      }));
    } catch (error) {
      return [];
    }
  }

  // Search methods

  /**
   * Search Wikidata
   */
  async searchWikidata(query, options = {}) {
    const { limit = 10 } = options;
    
    // Validate input to prevent malformed SPARQL queries
    if (!query || typeof query !== 'string' || query.trim() === '') {
      console.warn('[KnowledgeFederation] Invalid query for Wikidata search:', query);
      return [];
    }

    const sanitizedQuery = query.trim();
    
    const sparqlQuery = `
      SELECT DISTINCT ?item ?itemLabel ?itemDescription WHERE {
        ?item rdfs:label ?itemLabel .
        FILTER(CONTAINS(LCASE(?itemLabel), LCASE("${sanitizedQuery}")))
        FILTER(LANG(?itemLabel) = "en")
        OPTIONAL { ?item schema:description ?itemDescription . FILTER(LANG(?itemDescription) = "en") }
      } LIMIT ${limit}
    `;
    
    try {
      const results = await sparqlClient.executeQuery('wikidata', sparqlQuery);
      return results.map(result => ({
        title: result.itemLabel?.value,
        snippet: result.itemDescription?.value,
        uri: result.item?.value,
        confidence: this.calculateSearchConfidence(sanitizedQuery, result.itemLabel?.value || '')
      }));
    } catch (error) {
      return [];
    }
  }

  /**
   * Search DBpedia
   */
  async searchDBpedia(query, options = {}) {
    const { limit = 10 } = options;
    
    const sparqlQuery = `
      SELECT DISTINCT ?resource ?label ?comment WHERE {
        ?resource rdfs:label ?label .
        FILTER(CONTAINS(LCASE(?label), LCASE("${query}")))
        FILTER(LANG(?label) = "en")
        OPTIONAL { ?resource rdfs:comment ?comment . FILTER(LANG(?comment) = "en") }
      } LIMIT ${limit}
    `;
    
    try {
      const results = await sparqlClient.executeQuery('dbpedia', sparqlQuery);
      return results.map(result => ({
        title: result.label?.value,
        snippet: result.comment?.value?.substring(0, 200) + '...',
        uri: result.resource?.value,
        confidence: this.calculateSearchConfidence(query, result.label?.value || '')
      }));
    } catch (error) {
      return [];
    }
  }

  /**
   * Search ConceptNet
   */
  async searchConceptNet(query, options = {}) {
    const { limit = 10 } = options;
    
    try {
      const response = await fetch(`/api/conceptnet/search?text=${encodeURIComponent(query)}&limit=${limit}`);
      if (!response.ok) return [];
      
      const data = await response.json();
      return data.edges.map(edge => ({
        title: this.extractConceptNetLabel(edge.start),
        snippet: `${edge.rel?.label || 'relates to'} ${this.extractConceptNetLabel(edge.end)}`,
        uri: edge.start['@id'],
        confidence: edge.weight || 0.5
      }));
    } catch (error) {
      return [];
    }
  }

  // Utility methods

  /**
   * Identify clusters in the knowledge graph
   */
  identifyClusters(entities, relationships) {
    const clusters = new Map();
    const visited = new Set();
    
    // Simple clustering based on relationship density
    for (const [entityId] of entities) {
      if (visited.has(entityId)) continue;
      
      const cluster = this.findConnectedEntities(entityId, relationships, visited);
      if (cluster.length > 1) {
        clusters.set(`cluster_${clusters.size}`, {
          entities: cluster,
          size: cluster.length,
          density: this.calculateClusterDensity(cluster, relationships)
        });
      }
    }
    
    return clusters;
  }

  /**
   * Find connected entities using DFS
   */
  findConnectedEntities(startEntity, relationships, visited) {
    const cluster = [startEntity];
    visited.add(startEntity);
    
    const connected = relationships
      .filter(rel => rel.source === startEntity || rel.target === startEntity)
      .map(rel => rel.source === startEntity ? rel.target : rel.source)
      .filter(entity => !visited.has(entity));
    
    for (const entity of connected) {
      cluster.push(...this.findConnectedEntities(entity, relationships, visited));
    }
    
    return cluster;
  }

  /**
   * Calculate cluster density
   */
  calculateClusterDensity(entities, relationships) {
    const clusterRelationships = relationships.filter(rel => 
      entities.includes(rel.source) && entities.includes(rel.target)
    );
    const maxPossibleEdges = entities.length * (entities.length - 1) / 2;
    return maxPossibleEdges > 0 ? clusterRelationships.length / maxPossibleEdges : 0;
  }

  /**
   * Calculate search confidence based on query match
   */
  calculateSearchConfidence(query, title) {
    const queryLower = query.toLowerCase();
    const titleLower = title.toLowerCase();
    
    if (titleLower === queryLower) return 1.0;
    if (titleLower.includes(queryLower)) return 0.8;
    
    // Calculate word overlap
    const queryWords = queryLower.split(/\s+/);
    const titleWords = titleLower.split(/\s+/);
    const overlap = queryWords.filter(word => titleWords.includes(word)).length;
    
    return Math.min(0.9, overlap / queryWords.length);
  }

  /**
   * Simplify DBpedia property URIs
   */
  simplifyDBpediaProperty(propertyUri) {
    if (!propertyUri) return 'related_to';
    
    const propertyMap = {
      'dbo:birthPlace': 'born_in',
      'dbo:deathPlace': 'died_in', 
      'dbo:occupation': 'works_as',
      'dbo:spouse': 'married_to',
      'dbo:parent': 'child_of',
      'dbo:child': 'parent_of',
      'dbo:foundationPlace': 'founded_in',
      'dbo:location': 'located_in',
      'dbo:manufacturer': 'made_by',
      'dbo:genre': 'type_of'
    };
    
    for (const [uri, label] of Object.entries(propertyMap)) {
      if (propertyUri.includes(uri.split(':')[1])) {
        return label;
      }
    }
    
    // Extract last part of URI
    const parts = propertyUri.split(/[\/#]/);
    return parts[parts.length - 1].replace(/([A-Z])/g, '_$1').toLowerCase();
  }

  /**
   * Extract readable label from ConceptNet URI
   */
  extractConceptNetLabel(conceptUri) {
    if (typeof conceptUri === 'string') {
      const parts = conceptUri.split('/');
      return parts[parts.length - 1].replace(/_/g, ' ');
    }
    
    if (conceptUri && conceptUri.label) {
      return conceptUri.label;
    }
    
    return 'unknown';
  }
}

export const knowledgeFederation = new KnowledgeFederation();