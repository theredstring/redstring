/**
 * @module sparqlClient
 * @description SPARQL query client for Redstring's semantic web integration.
 *
 * Provides a singleton `SPARQLClient` instance pre-configured for Wikidata, DBpedia,
 * and Schema.org. Features include:
 * - Per-endpoint rate limiting (queued, not dropped)
 * - 1-hour result cache keyed by endpoint + query hash
 * - SSRF guard on caller-supplied endpoint URLs
 * - Automatic GET/POST selection (GET for short queries and Wikidata to avoid CORS preflight)
 *
 * Convenience wrapper functions (`executeQuery`, `findEquivalentClasses`,
 * `searchEntities`, `testEndpoint`) delegate to the singleton.
 */

import { SimpleClient as SparqlHttpClient } from 'sparql-http-client';
import { createTimeoutSignal } from '../utils/abortSignal.js';

// SSRF guard for caller-supplied endpoint URLs. SPARQL endpoints should be
// public https URLs — never internal services, cloud metadata, or loopback.
// Predefined entries below bypass this since they're hardcoded.
function assertSafeSparqlUrl(url) {
  if (typeof url !== 'string' || !url) {
    throw new Error('SPARQL endpoint requires a url');
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`SPARQL endpoint URL is invalid: ${url}`);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`SPARQL endpoint must be http(s): ${url}`);
  }
  const host = parsed.hostname.toLowerCase();
  // Block loopback, link-local, cloud metadata, and obviously-private ranges.
  // Not a full CIDR check, but covers the SSRF foot-guns that matter in
  // practice (AWS/GCP/Azure metadata + LAN scanning).
  const blocked = [
    'localhost',
    '127.0.0.1',
    '0.0.0.0',
    '169.254.169.254', // AWS/GCP/Azure metadata
    'metadata.google.internal',
  ];
  if (blocked.includes(host)) {
    throw new Error(`SPARQL endpoint host is blocked: ${host}`);
  }
  if (
    host.startsWith('10.') ||
    host.startsWith('192.168.') ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host) ||
    host.startsWith('169.254.') ||
    host === '::1' ||
    host.startsWith('fc') ||
    host.startsWith('fd')
  ) {
    throw new Error(`SPARQL endpoint host is in a private range: ${host}`);
  }
}

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

/**
 * SPARQL query client with built-in rate limiting, caching, and SSRF guards.
 *
 * @class
 */
export class SPARQLClient {
  constructor() {
    this.endpoints = new Map(Object.entries(PREDEFINED_ENDPOINTS));
    this.clients = new Map();
    this.lastRequestTime = new Map();
    this.queryCache = new Map();
    this.CACHE_TTL = 60 * 60 * 1000; // 1 hour
  }

  /**
   * Registers a custom SPARQL endpoint, replacing any existing entry with the same key.
   *
   * Validates the URL against the SSRF guard before storing. Clears any cached
   * HTTP client for the key so the next query gets a fresh connection.
   *
   * @param {string} key - Unique identifier for this endpoint.
   * @param {Object} config - Endpoint configuration.
   * @param {string} config.url - SPARQL endpoint URL (must be https or http, no private ranges).
   * @param {number} [config.rateLimit=1000] - Minimum ms between requests to this endpoint.
   * @param {number} [config.timeout=20000] - Request timeout in ms.
   * @param {Object} [config.headers={}] - Extra HTTP headers to include.
   * @throws {Error} If `config.url` fails the SSRF safety check.
   */
  addEndpoint(key, config) {
    assertSafeSparqlUrl(config?.url);
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
   * Removes a custom endpoint by key.
   *
   * Predefined endpoints (`wikidata`, `dbpedia`, `schema`) cannot be removed.
   *
   * @param {string} key - Identifier of the endpoint to remove.
   * @throws {Error} If `key` matches a predefined endpoint.
   */
  removeEndpoint(key) {
    if (PREDEFINED_ENDPOINTS[key]) {
      throw new Error(`Cannot remove predefined endpoint: ${key}`);
    }
    
    this.endpoints.delete(key);
    this.clients.delete(key);
  }

  /**
   * Returns the configuration object for the named endpoint.
   *
   * @param {string} key - Endpoint identifier.
   * @returns {Object|undefined} Endpoint config, or `undefined` if not found.
   */
  getEndpoint(key) {
    return this.endpoints.get(key);
  }

  /**
   * Returns all registered endpoints as an array.
   *
   * @returns {Array<Object>} Each object contains `key` plus all endpoint config fields.
   */
  listEndpoints() {
    return Array.from(this.endpoints.entries()).map(([key, config]) => ({
      key,
      ...config
    }));
  }

  /**
   * Executes a SPARQL SELECT query and returns the bindings array.
   *
   * Uses GET for queries under 4000 characters or targeting Wikidata (avoids CORS
   * preflight); POST otherwise. Results are cached for 1 hour per endpoint+query.
   * Applies per-endpoint rate limiting before each request.
   *
   * @param {string} endpointKey - Registered endpoint identifier.
   * @param {string} query - SPARQL SELECT query string.
   * @param {Object} [options={}] - Request options.
   * @param {AbortSignal} [options.signal] - External abort signal; overrides the endpoint timeout.
   * @param {Object} [options.headers] - Extra headers merged with endpoint defaults.
   * @returns {Promise<Array<Object>>} Array of binding objects; each key maps to `{ value, type, ... }`.
   * @throws {Error} On HTTP error or network failure.
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
      // Use GET by default to avoid CORS preflight issues on standard endpoints like Wikidata
      const useGet = query.length < 4000 || endpoint.url.includes('wikidata.org');
      
      const fetchOptions = {
        method: useGet ? 'GET' : 'POST',
        headers: {
          'Accept': 'application/sparql-results+json',
          ...endpoint.headers,
          ...options.headers
        },
        signal: timeoutControl.signal
      };

      if (!useGet) {
        fetchOptions.headers['Content-Type'] = 'application/x-www-form-urlencoded';
        fetchOptions.body = `query=${encodeURIComponent(query)}`;
      }

      // Browsers will ignore custom User-Agent headers, but it's kept in endpoint.headers
      const url = useGet 
        ? `${endpoint.url}?query=${encodeURIComponent(query)}` 
        : endpoint.url;

      console.log(`[SPARQL Client] Direct fetch query to ${endpointKey} (method: ${fetchOptions.method}):`, query.substring(0, 100) + '...');
      
      // Use direct fetch instead of sparql-http-client
      const response = await fetch(url, fetchOptions);

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
   * Executes a SPARQL CONSTRUCT query and returns an array of RDF triples.
   *
   * @param {string} endpointKey - Registered endpoint identifier.
   * @param {string} query - SPARQL CONSTRUCT query string.
   * @param {Object} [options={}] - Request options (same shape as `executeQuery`).
   * @returns {Promise<Array<{subject: string, predicate: string, object: string, graph: string|null}>>} Parsed triples.
   * @throws {Error} On HTTP error or network failure.
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
   * Queries for classes equivalent to the given URI via `owl:equivalentClass` and `owl:sameAs`.
   *
   * @param {string} endpointKey - Registered endpoint identifier.
   * @param {string} classUri - Full URI of the class to find equivalents for.
   * @returns {Promise<string[]>} Array of equivalent class URI strings (up to 50).
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
   * Queries for direct subclasses of the given class URI via `rdfs:subClassOf`.
   *
   * @param {string} endpointKey - Registered endpoint identifier.
   * @param {string} classUri - Full URI of the parent class.
   * @returns {Promise<string[]>} Array of subclass URI strings (up to 100).
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
   * Queries for direct superclasses of the given class URI via `rdfs:subClassOf`.
   *
   * @param {string} endpointKey - Registered endpoint identifier.
   * @param {string} classUri - Full URI of the child class.
   * @returns {Promise<string[]>} Array of superclass URI strings (up to 50).
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
   * Searches for RDF entities whose `rdfs:label` contains the search term (case-insensitive).
   *
   * @param {string} endpointKey - Registered endpoint identifier.
   * @param {string} searchTerm - Label substring to search for.
   * @param {string|null} [entityType=null] - Optional RDF type URI to restrict results.
   * @returns {Promise<Array<{uri: string, label: string, type: string}>>} Matching entities (up to 20).
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
   * Probes an endpoint with a minimal SELECT query to verify connectivity.
   *
   * @param {string} endpointKey - Registered endpoint identifier.
   * @returns {Promise<{endpoint: string, status: 'connected'|'error', responseTime?: number, error?: string, timestamp: string}>} Connectivity result.
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
    const now = Date.now();
    const lastRequest = this.lastRequestTime.get(endpointKey) || 0;
    
    // Calculate when this request is allowed to run
    const allowedTime = Math.max(now, lastRequest + rateLimit);
    
    // Reserve this time slot for the current request
    this.lastRequestTime.set(endpointKey, allowedTime);
    
    const waitTime = allowedTime - now;
    if (waitTime > 0) {
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
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
   * Clears cached query results.
   *
   * @param {string|null} [endpointKey=null] - If provided, clears only cache entries for that endpoint; otherwise clears all.
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
   * Returns cache statistics broken down by valid and expired entries.
   *
   * @returns {{ totalEntries: number, validEntries: number, expiredEntries: number }} Cache stats.
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

/** @see {@link SPARQLClient#executeQuery} */
export const executeQuery = (endpointKey, query, options) =>
  sparqlClient.executeQuery(endpointKey, query, options);
/** @see {@link SPARQLClient#findEquivalentClasses} */
export const findEquivalentClasses = (endpointKey, classUri) =>
  sparqlClient.findEquivalentClasses(endpointKey, classUri);
/** @see {@link SPARQLClient#searchEntities} */
export const searchEntities = (endpointKey, searchTerm, entityType) =>
  sparqlClient.searchEntities(endpointKey, searchTerm, entityType);
/** @see {@link SPARQLClient#testEndpoint} */
export const testEndpoint = (endpointKey) =>
  sparqlClient.testEndpoint(endpointKey);
