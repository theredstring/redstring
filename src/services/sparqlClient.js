/**
 * SPARQL Client Service
 * 
 * Handles queries to external SPARQL endpoints for semantic web data integration.
 */

import { SimpleClient as SparqlHttpClient } from 'sparql-http-client';
import { createTimeoutSignal } from '../utils/abortSignal.js';

// Predefined SPARQL endpoints for major knowledge bases
const PREDEFINED_ENDPOINTS = {
  wikidata: {
    name: 'Wikidata',
    url: 'https://query.wikidata.org/sparql',
    description: 'Wikimedia knowledge base',
    defaultGraph: null,
    rateLimit: 1000, // ms between requests
    timeout: 30000, // 30 seconds
    headers: {
      'User-Agent': 'Redstring-SPARQL-Client/1.0'
    }
  },
  dbpedia: {
    name: 'DBpedia',
    url: 'https://dbpedia.org/sparql',
    description: 'Structured data from Wikipedia',
    defaultGraph: 'http://dbpedia.org',
    rateLimit: 500,
    timeout: 20000,
    headers: {
      'Accept': 'application/sparql-results+json'
    }
  },
  schema: {
    name: 'Schema.org',
    url: 'https://schema.org/sparql',
    description: 'Schema.org vocabulary',
    defaultGraph: 'https://schema.org',
    rateLimit: 1000,
    timeout: 15000,
    headers: {}
  }
};

export class SPARQLClient {
  constructor() {
    this.endpoints = new Map(Object.entries(PREDEFINED_ENDPOINTS));
    this.clients = new Map();
    this.lastRequestTime = new Map();
    this.queryCache = new Map();
    this.CACHE_TTL = 60 * 60 * 1000; // 1 hour
  }

  /**
   * Add a custom SPARQL endpoint
   * @param {string} key - Endpoint identifier
   * @param {Object} config - Endpoint configuration
   */
  addEndpoint(key, config) {
    this.endpoints.set(key, {
      ...config,
      rateLimit: config.rateLimit || 1000,
      timeout: config.timeout || 20000,
      headers: config.headers || {}
    });
    
    // Clear cached client
    this.clients.delete(key);
  }

  /**
   * Remove a custom endpoint
   * @param {string} key - Endpoint identifier
   */
  removeEndpoint(key) {
    if (PREDEFINED_ENDPOINTS[key]) {
      throw new Error(`Cannot remove predefined endpoint: ${key}`);
    }
    
    this.endpoints.delete(key);
    this.clients.delete(key);
  }

  /**
   * Get endpoint configuration
   * @param {string} key - Endpoint identifier
   * @returns {Object} Endpoint configuration
   */
  getEndpoint(key) {
    return this.endpoints.get(key);
  }

  /**
   * List all available endpoints
   * @returns {Array} Array of endpoint configurations
   */
  listEndpoints() {
    return Array.from(this.endpoints.entries()).map(([key, config]) => ({
      key,
      ...config
    }));
  }

  /**
   * Execute a SPARQL query using direct fetch (bypasses sparql-http-client issues)
   * @param {string} endpointKey - Endpoint identifier
   * @param {string} query - SPARQL query string
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Query results as bindings array
   */
  async executeQuery(endpointKey, query, options = {}) {
    const endpoint = this.endpoints.get(endpointKey);
    if (!endpoint) {
      throw new Error(`Unknown endpoint: ${endpointKey}`);
    }

    // Check rate limiting
    await this._checkRateLimit(endpointKey, endpoint.rateLimit);

    // Check cache
    const cacheKey = `${endpointKey}:${this._hashQuery(query)}`;
    if (this.queryCache.has(cacheKey)) {
      const cached = this.queryCache.get(cacheKey);
      if (Date.now() - cached.timestamp < this.CACHE_TTL) {
        return cached.data;
      }
      this.queryCache.delete(cacheKey);
    }

    const timeoutControl = options.signal
      ? { signal: options.signal, cleanup: () => {} }
      : createTimeoutSignal(endpoint.timeout);

    try {
      const fetchOptions = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/sparql-results+json',
          'User-Agent': 'Redstring-SPARQL-Client/1.0',
          ...endpoint.headers,
          ...options.headers
        },
        body: `query=${encodeURIComponent(query)}`,
        signal: timeoutControl.signal
      };

      console.log(`[SPARQL Client] Direct fetch query to ${endpointKey}:`, query.substring(0, 100) + '...');
      
      // Use direct fetch instead of sparql-http-client
      const response = await fetch(endpoint.url, fetchOptions);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const jsonData = await response.json();
      console.log(`[SPARQL Client] Direct fetch result for ${endpointKey}:`, {
        hasResults: !!jsonData.results,
        bindingsCount: jsonData.results?.bindings?.length || 0,
        head: jsonData.head,
        sampleBinding: jsonData.results?.bindings?.[0]
      });

      // Extract just the bindings array
      const bindings = jsonData?.results?.bindings || [];
      
      // Cache the result
      this.queryCache.set(cacheKey, {
        data: bindings,
        timestamp: Date.now()
      });

      return bindings;
    } catch (error) {
      console.error(`[SPARQL Client] Direct fetch query failed for ${endpointKey}:`, error);
      throw new Error(`SPARQL query failed: ${error.message}`);
    } finally {
      timeoutControl.cleanup();
    }
  }

  /**
   * Execute a CONSTRUCT query and return RDF triples
   * @param {string} endpointKey - Endpoint identifier
   * @param {string} query - SPARQL CONSTRUCT query
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Array of RDF triples
   */
  async executeConstructQuery(endpointKey, query, options = {}) {
    const endpoint = this.endpoints.get(endpointKey);
    if (!endpoint) {
      throw new Error(`Unknown endpoint: ${endpointKey}`);
    }

    await this._checkRateLimit(endpointKey, endpoint.rateLimit);

    const timeoutControl = options.signal
      ? { signal: options.signal, cleanup: () => {} }
      : createTimeoutSignal(endpoint.timeout);

    try {
      const client = await this._getClient(endpointKey, endpoint);
      const result = await client.query.construct(query, {
        signal: timeoutControl.signal,
        headers: { ...endpoint.headers, ...options.headers }
      });

      return await this._parseConstructResult(result);
    } catch (error) {
      console.error(`[SPARQL Client] CONSTRUCT query failed for ${endpointKey}:`, error);
      throw new Error(`SPARQL CONSTRUCT query failed: ${error.message}`);
    } finally {
      timeoutControl.cleanup();
    }
  }

  /**
   * Query for equivalent classes
   * @param {string} endpointKey - Endpoint identifier
   * @param {string} classUri - URI of the class to find equivalents for
   * @returns {Promise<Array>} Array of equivalent class URIs
   */
  async findEquivalentClasses(endpointKey, classUri) {
    const query = `
      SELECT DISTINCT ?equivalentClass WHERE {
        {
          <${classUri}> owl:equivalentClass ?equivalentClass .
        }
        UNION
        {
          ?equivalentClass owl:equivalentClass <${classUri}> .
        }
        UNION
        {
          <${classUri}> owl:sameAs ?equivalentClass .
        }
        UNION
        {
          ?equivalentClass owl:sameAs <${classUri}> .
        }
      }
      LIMIT 50
    `;

    const result = await this.executeQuery(endpointKey, query);
    return result.map(binding => binding.equivalentClass?.value).filter(Boolean);
  }

  /**
   * Query for subclasses
   * @param {string} endpointKey - Endpoint identifier
   * @param {string} classUri - URI of the parent class
   * @returns {Promise<Array>} Array of subclass URIs
   */
  async findSubClasses(endpointKey, classUri) {
    const query = `
      SELECT DISTINCT ?subClass WHERE {
        ?subClass rdfs:subClassOf <${classUri}> .
      }
      LIMIT 100
    `;

    const result = await this.executeQuery(endpointKey, query);
    return result.map(binding => binding.subClass?.value).filter(Boolean);
  }

  /**
   * Query for superclasses
   * @param {string} endpointKey - Endpoint identifier
   * @param {string} classUri - URI of the child class
   * @returns {Promise<Array>} Array of superclass URIs
   */
  async findSuperClasses(endpointKey, classUri) {
    const query = `
      SELECT DISTINCT ?superClass WHERE {
        <${classUri}> rdfs:subClassOf ?superClass .
      }
      LIMIT 50
    `;

    const result = await this.executeQuery(endpointKey, query);
    return result.map(binding => binding.superClass?.value).filter(Boolean);
  }

  /**
   * Search for entities by label
   * @param {string} endpointKey - Endpoint identifier
   * @param {string} searchTerm - Search term
   * @param {string} entityType - Type of entity to search for (e.g., 'Class', 'Property')
   * @returns {Promise<Array>} Array of matching entities
   */
  async searchEntities(endpointKey, searchTerm, entityType = null) {
    let typeFilter = '';
    if (entityType) {
      typeFilter = `FILTER(?type = <${entityType}>) .`;
    }

    const query = `
      SELECT DISTINCT ?entity ?label ?type WHERE {
        ?entity rdfs:label ?label .
        ?entity a ?type .
        FILTER(CONTAINS(LCASE(?label), LCASE("${searchTerm}")) || 
               CONTAINS(LCASE(?entity), LCASE("${searchTerm}"))) .
        ${typeFilter}
      }
      LIMIT 20
    `;

    const result = await this.executeQuery(endpointKey, query);
    return result.map(binding => ({
      uri: binding.entity?.value,
      label: binding.label?.value,
      type: binding.type?.value
    })).filter(item => item.uri && item.label);
  }

  /**
   * Test endpoint connectivity
   * @param {string} endpointKey - Endpoint identifier
   * @returns {Promise<Object>} Connectivity test result
   */
  async testEndpoint(endpointKey) {
    const endpoint = this.endpoints.get(endpointKey);
    if (!endpoint) {
      throw new Error(`Unknown endpoint: ${endpointKey}`);
    }

    try {
      const startTime = Date.now();
      const result = await this.executeQuery(endpointKey, 'SELECT ?s WHERE { ?s ?p ?o } LIMIT 1');
      const responseTime = Date.now() - startTime;

      return {
        endpoint: endpointKey,
        status: 'connected',
        responseTime,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        endpoint: endpointKey,
        status: 'error',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Get SPARQL client for an endpoint (legacy method - now using direct fetch)
   * @private
   */
  async _getClient(endpointKey, endpoint) {
    // Legacy method kept for compatibility but no longer used
    return null;
  }

  /**
   * Check rate limiting for an endpoint
   * @private
   */
  async _checkRateLimit(endpointKey, rateLimit) {
    const lastRequest = this.lastRequestTime.get(endpointKey) || 0;
    const timeSinceLastRequest = Date.now() - lastRequest;
    
    if (timeSinceLastRequest < rateLimit) {
      const waitTime = rateLimit - timeSinceLastRequest;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    this.lastRequestTime.set(endpointKey, Date.now());
  }

  /**
   * Parse SELECT query results
   * @private
   */
  async _parseQueryResult(result) {
    try {
      // Handle different result formats from sparql-http-client
      if (result && typeof result === 'object') {
        // Handle sparql-http-client _Patchable objects (stream already consumed)
        if (result.constructor && result.constructor.name === '_Patchable') {
          // Log all properties to understand the _Patchable structure
          const patchableProps = {};
          const keys = Object.keys(result);
          keys.forEach(key => {
            const value = result[key];
            if (typeof value === 'function') {
              patchableProps[key] = 'function';
            } else if (Array.isArray(value)) {
              patchableProps[key] = `array[${value.length}]`;
            } else if (value && typeof value === 'object') {
              patchableProps[key] = `object(${value.constructor?.name || 'unknown'})`;
            } else {
              patchableProps[key] = typeof value;
            }
          });
          
          console.log('[SPARQL Client] _Patchable keys:', keys);
          console.log('[SPARQL Client] _Patchable properties:', patchableProps);
          
          // Also try to see what methods might be available  
          const prototypeMethods = [];
          let current = result;
          while (current && current !== Object.prototype) {
            Object.getOwnPropertyNames(current).forEach(prop => {
              if (typeof current[prop] === 'function' && !prototypeMethods.includes(prop)) {
                prototypeMethods.push(prop);
              }
            });
            current = Object.getPrototypeOf(current);
          }
          console.log('[SPARQL Client] _Patchable methods:', prototypeMethods);
          
          // _Patchable objects are already processed streams, check if they have bindings
          if (result.bindings && Array.isArray(result.bindings)) {
            return {
              head: { vars: result.variables || [] },
              results: { bindings: result.bindings }
            };
          }
          
          // Try various methods to extract data from the _Patchable object
          // First try clone() to get an unconsumed copy
          if (typeof result.clone === 'function') {
            try {
              console.log('[SPARQL Client] Attempting _Patchable.clone().json()...');
              const clonedResult = result.clone();
              const jsonData = await clonedResult.json();
              console.log('[SPARQL Client] Cloned _Patchable JSON data:', jsonData);
              if (jsonData && jsonData.results && jsonData.results.bindings) {
                return jsonData;
              }
              return jsonData || { head: { vars: [] }, results: { bindings: [] } };
            } catch (cloneError) {
              console.warn('[SPARQL Client] Failed to clone and parse _Patchable:', cloneError);
            }
          }
          
          // If clone failed, try text() method
          if (typeof result.text === 'function') {
            try {
              console.log('[SPARQL Client] Attempting _Patchable.text()...');
              const textData = await result.text();
              console.log('[SPARQL Client] _Patchable text data (first 200 chars):', textData.substring(0, 200));
              const jsonData = JSON.parse(textData);
              if (jsonData && jsonData.results && jsonData.results.bindings) {
                return jsonData;
              }
              return jsonData || { head: { vars: [] }, results: { bindings: [] } };
            } catch (textError) {
              console.warn('[SPARQL Client] Failed to parse text from _Patchable:', textError);
            }
          }
          
          // Try to call methods that might exist on _Patchable to get data
          try {
            // Try calling toArray() if it exists (common in sparql-http-client)
            if (typeof result.toArray === 'function') {
              console.log('[SPARQL Client] Attempting result.toArray()...');
              const arrayResult = await result.toArray();
              console.log('[SPARQL Client] toArray() result:', arrayResult);
              if (Array.isArray(arrayResult) && arrayResult.length > 0) {
                return {
                  head: { vars: Object.keys(arrayResult[0] || {}) },
                  results: { bindings: arrayResult }
                };
              }
            }
          } catch (toArrayError) {
            console.warn('[SPARQL Client] toArray() failed:', toArrayError);
          }
          
          // Try to access common SPARQL result methods on _Patchable
          const asyncIteratorMethod = result[Symbol.asyncIterator];
          if (asyncIteratorMethod && typeof asyncIteratorMethod === 'function') {
            const bindings = [];
            try {
              for await (const binding of result) {
                if (binding && typeof binding === 'object') {
                  const parsedBinding = {};
                  for (const [key, value] of Object.entries(binding)) {
                    if (value && typeof value === 'object' && 'value' in value) {
                      parsedBinding[key] = {
                        value: value.value,
                        type: value.termType || 'literal',
                        datatype: value.datatype?.value,
                        language: value.language
                      };
                    } else {
                      parsedBinding[key] = {
                        value: String(value),
                        type: 'literal',
                        datatype: null,
                        language: null
                      };
                    }
                  }
                  bindings.push(parsedBinding);
                }
              }
            } catch (iterationError) {
              console.warn('[SPARQL Client] Error iterating over _Patchable:', iterationError);
            }
            
            return {
              head: { vars: result.variables || [] },
              results: { bindings }
            };
          }
          
          // Fall back to empty result for _Patchable objects we can't parse
          console.warn('[SPARQL Client] _Patchable object without accessible data, returning empty result');
          return {
            head: { vars: [] },
            results: { bindings: [] }
          };
        }

        // Handle standard Response objects
        if (typeof result.json === 'function' && result.constructor && result.constructor.name === 'Response') {
          try {
            const jsonData = await result.json();
            console.log('[SPARQL Client] JSON response data:', {
              hasResults: !!jsonData.results,
              bindingsCount: jsonData.results?.bindings?.length || 0,
              head: jsonData.head,
              sampleBinding: jsonData.results?.bindings?.[0]
            });
            if (jsonData && jsonData.results && jsonData.results.bindings) {
              return jsonData;
            }
            // Return even empty results in correct format
            return jsonData || { head: { vars: [] }, results: { bindings: [] } };
          } catch (jsonError) {
            console.warn('[SPARQL Client] Failed to parse JSON from Response:', jsonError);
          }
        }

        // If result has a bindings property, it's already parsed
        if (result.bindings && Array.isArray(result.bindings)) {
          return {
            head: { vars: result.variables || [] },
            results: { bindings: result.bindings }
          };
        }
        
        // If result has a results property, it's in the expected format
        if (result.results && result.results.bindings) {
          return result;
        }
        
        // If result is iterable, parse it manually
        if (result[Symbol.asyncIterator] || result[Symbol.iterator]) {
          const bindings = [];
          
          try {
            for await (const binding of result) {
              if (binding && typeof binding === 'object') {
                const parsedBinding = {};
                for (const [key, value] of Object.entries(binding)) {
                  if (value && typeof value === 'object' && 'value' in value) {
                    parsedBinding[key] = {
                      value: value.value,
                      type: value.termType || 'literal',
                      datatype: value.datatype?.value,
                      language: value.language
                    };
                  } else {
                    // Handle simple string values
                    parsedBinding[key] = {
                      value: String(value),
                      type: 'literal',
                      datatype: null,
                      language: null
                    };
                  }
                }
                bindings.push(parsedBinding);
              }
            }
          } catch (iterationError) {
            console.warn('[SPARQL Client] Error iterating over result:', iterationError);
          }
          
          return {
            head: { vars: result.variables || [] },
            results: { bindings }
          };
        }
      }
      
      // Fallback: return empty result structure
      console.warn('[SPARQL Client] Unexpected result format:', result);
      return {
        head: { vars: [] },
        results: { bindings: [] }
      };
    } catch (error) {
      console.error('[SPARQL Client] Error parsing query result:', error);
      return {
        head: { vars: [] },
        results: { bindings: [] }
      };
    }
  }

  /**
   * Parse CONSTRUCT query results
   * @private
   */
  async _parseConstructResult(result) {
    try {
      const triples = [];
      
      // Handle different result formats
      if (result && typeof result === 'object') {
        // If result is already an array of triples
        if (Array.isArray(result)) {
          return result;
        }
        
        // If result is iterable, parse it manually
        if (result[Symbol.asyncIterator] || result[Symbol.iterator]) {
          try {
            for await (const quad of result) {
              if (quad && typeof quad === 'object') {
                const triple = {
                  subject: quad.subject?.value || String(quad.subject),
                  predicate: quad.predicate?.value || String(quad.predicate),
                  object: quad.object?.value || String(quad.object),
                  graph: quad.graph?.value || null
                };
                triples.push(triple);
              }
            }
          } catch (iterationError) {
            console.warn('[SPARQL Client] Error iterating over CONSTRUCT result:', iterationError);
          }
        }
      }
      
      return triples;
    } catch (error) {
      console.error('[SPARQL Client] Error parsing CONSTRUCT result:', error);
      return [];
    }
  }

  /**
   * Hash a query string for caching
   * @private
   */
  _hashQuery(query) {
    let hash = 0;
    for (let i = 0; i < query.length; i++) {
      const char = query.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString();
  }

  /**
   * Clear query cache
   * @param {string} endpointKey - Optional endpoint to clear specific cache
   */
  clearCache(endpointKey = null) {
    if (endpointKey) {
      // Clear specific endpoint cache
      for (const key of this.queryCache.keys()) {
        if (key.startsWith(endpointKey + ':')) {
          this.queryCache.delete(key);
        }
      }
    } else {
      // Clear all cache
      this.queryCache.clear();
    }
  }

  /**
   * Get cache statistics
   * @returns {Object} Cache statistics
   */
  getCacheStats() {
    const now = Date.now();
    let validEntries = 0;
    let expiredEntries = 0;
    
    for (const [key, value] of this.queryCache.entries()) {
      if (now - value.timestamp < this.CACHE_TTL) {
        validEntries++;
      } else {
        expiredEntries++;
      }
    }
    
    return {
      totalEntries: this.queryCache.size,
      validEntries,
      expiredEntries
    };
  }
}

// Export singleton instance
export const sparqlClient = new SPARQLClient();

// Export utility functions
export const executeQuery = (endpointKey, query, options) => 
  sparqlClient.executeQuery(endpointKey, query, options);
export const findEquivalentClasses = (endpointKey, classUri) => 
  sparqlClient.findEquivalentClasses(endpointKey, classUri);
export const searchEntities = (endpointKey, searchTerm, entityType) => 
  sparqlClient.searchEntities(endpointKey, searchTerm, entityType);
export const testEndpoint = (endpointKey) => 
  sparqlClient.testEndpoint(endpointKey);
