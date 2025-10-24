/**
 * RDF Resolver Service
 * 
 * Handles URI dereferencing, content negotiation, and parsing of RDF formats
 * to resolve external URIs to actual RDF data.
 */

import N3Parser from '@rdfjs/parser-n3';
import JsonLDParser from '@rdfjs/parser-jsonld';
import jsonld from 'jsonld';
import { createTimeoutSignal } from '../utils/abortSignal.js';

// RDF format priorities for content negotiation
const RDF_FORMATS = [
  { mimeType: 'text/turtle', priority: 1, parser: 'turtle' },
  { mimeType: 'application/ld+json', priority: 2, parser: 'jsonld' },
  { mimeType: 'application/rdf+xml', priority: 3, parser: 'xml' },
  { mimeType: 'application/n-triples', priority: 4, parser: 'ntriples' }
];

// Cache for resolved RDF data
const rdfCache = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

export class RDFResolver {
  constructor() {
    this.parsers = {
      turtle: new N3Parser(),
      jsonld: new JsonLDParser()
    };
    
    this.defaultHeaders = {
      'Accept': RDF_FORMATS.map(f => f.mimeType).join(', '),
      'User-Agent': 'Redstring-RDF-Resolver/1.0'
    };
  }

  /**
   * Resolve a URI to RDF data
   * @param {string} uri - The URI to resolve
   * @param {Object} options - Resolution options
   * @returns {Promise<Object>} Resolved RDF data
   */
  async resolveURI(uri, options = {}) {
    const cacheKey = this._getCacheKey(uri, options);
    
    // Check cache first
    if (rdfCache.has(cacheKey)) {
      const cached = rdfCache.get(cacheKey);
      if (Date.now() - cached.timestamp < CACHE_TTL) {
        return cached.data;
      }
      rdfCache.delete(cacheKey);
    }

    try {
      const result = await this._fetchAndParse(uri, options);
      
      // Cache the result
      rdfCache.set(cacheKey, {
        data: result,
        timestamp: Date.now()
      });
      
      return result;
    } catch (error) {
      console.error(`[RDF Resolver] Failed to resolve ${uri}:`, error);
      throw error;
    }
  }

  /**
   * Fetch and parse RDF data from a URI
   * @private
   */
  async _fetchAndParse(uri, options) {
    try {
      // Check if this is a known CORS-problematic domain
      if (this._isCORSProblematic(uri)) {
        console.warn(`[RDF Resolver] Skipping CORS-problematic URI: ${uri}`);
        return this._createFallbackData(uri);
      }

      const headers = { ...this.defaultHeaders, ...options.headers };
      const timeoutMs = typeof options.timeout === 'number' && options.timeout > 0 ? options.timeout : 10000;
      const timeoutControl = options.signal
        ? { signal: options.signal, cleanup: () => {} }
        : createTimeoutSignal(timeoutMs);
      
      // Try to fetch with content negotiation
      try {
        const response = await fetch(uri, {
          method: 'GET',
          headers,
          signal: timeoutControl.signal
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const contentType = response.headers.get('content-type') || '';
        const content = await response.text();
        
        if (!content.trim()) {
          throw new Error('Empty response from URI');
        }

        // Parse based on content type
        const parsedData = await this._parseContent(content, contentType, uri);
        
        return {
          uri,
          contentType,
          triples: parsedData.triples,
          metadata: parsedData.metadata,
          resolvedAt: new Date().toISOString()
        };
      } finally {
        timeoutControl.cleanup();
      }
    } catch (error) {
      // Handle CORS and network errors gracefully
      if (this._isCORSOrNetworkError(error)) {
        console.warn(`[RDF Resolver] CORS/Network error for ${uri}, using fallback`);
        return this._createFallbackData(uri);
      }
      
      throw error;
    }
  }

  /**
   * Parse RDF content based on content type
   * @private
   */
  async _parseContent(content, contentType, baseUri) {
    const mimeType = contentType.split(';')[0].trim().toLowerCase();
    
    try {
      if (mimeType.includes('turtle') || mimeType.includes('n3')) {
        return await this._parseTurtle(content, baseUri);
      } else if (mimeType.includes('json') || mimeType.includes('ld+json')) {
        return await this._parseJsonLD(content, baseUri);
      } else if (mimeType.includes('xml') || mimeType.includes('rdf+xml')) {
        return await this._parseRDFXML(content, baseUri);
      } else if (mimeType.includes('ntriples')) {
        return await this._parseNTriples(content, baseUri);
      } else {
        // Try to auto-detect format
        return await this._autoDetectAndParse(content, baseUri);
      }
    } catch (error) {
      console.error(`[RDF Resolver] Parsing failed for ${mimeType}:`, error);
      throw new Error(`Failed to parse RDF content: ${error.message}`);
    }
  }

  /**
   * Parse Turtle/N3 content
   * @private
   */
  async _parseTurtle(content, baseUri) {
    return new Promise((resolve, reject) => {
      const triples = [];
      const metadata = { format: 'turtle', baseUri };
      
      this.parsers.turtle.import(content)
        .on('data', (quad) => {
          triples.push({
            subject: this._termToString(quad.subject),
            predicate: this._termToString(quad.predicate),
            object: this._termToString(quad.object),
            graph: quad.graph ? this._termToString(quad.graph) : null
          });
        })
        .on('end', () => {
          resolve({ triples, metadata });
        })
        .on('error', reject);
    });
  }

  /**
   * Parse JSON-LD content
   * @private
   */
  async _parseJsonLD(content, baseUri) {
    try {
      const jsonData = JSON.parse(content);
      const expanded = await jsonld.expand(jsonData, { base: baseUri });
      
      const triples = [];
      for (const item of expanded) {
        for (const [predicate, objects] of Object.entries(item)) {
          if (predicate === '@id') continue;
          
          for (const obj of Array.isArray(objects) ? objects : [objects]) {
            if (typeof obj === 'object' && obj['@id']) {
              triples.push({
                subject: item['@id'],
                predicate,
                object: obj['@id'],
                graph: null
              });
            } else if (typeof obj === 'string' || typeof obj === 'number' || typeof obj === 'boolean') {
              triples.push({
                subject: item['@id'],
                predicate,
                object: obj.toString(),
                graph: null
              });
            }
          }
        }
      }
      
      return {
        triples,
        metadata: { format: 'jsonld', baseUri, expanded }
      };
    } catch (error) {
      throw new Error(`JSON-LD parsing failed: ${error.message}`);
    }
  }

  /**
   * Parse RDF/XML content (basic implementation)
   * @private
   */
  async _parseRDFXML(content, baseUri) {
    // For now, return basic structure - can be enhanced with proper XML parsing
    return {
      triples: [],
      metadata: { format: 'rdfxml', baseUri, note: 'RDF/XML parsing not yet implemented' }
    };
  }

  /**
   * Parse N-Triples content
   * @private
   */
  async _parseNTriples(content, baseUri) {
    const lines = content.split('\n').filter(line => line.trim());
    const triples = [];
    
    for (const line of lines) {
      if (line.startsWith('#')) continue; // Skip comments
      
      const parts = line.split(' ');
      if (parts.length >= 3) {
        const subject = parts[0];
        const predicate = parts[1];
        let object = parts.slice(2).join(' ').trim();
        
        // Remove trailing period
        if (object.endsWith('.')) {
          object = object.slice(0, -1);
        }
        
        triples.push({ subject, predicate, object, graph: null });
      }
    }
    
    return {
      triples,
      metadata: { format: 'ntriples', baseUri }
    };
  }

  /**
   * Auto-detect format and parse
   * @private
   */
  async _autoDetectAndParse(content, baseUri) {
    // Try different formats in order of preference
    const formats = ['turtle', 'jsonld', 'ntriples'];
    
    for (const format of formats) {
      try {
        if (format === 'turtle') {
          return await this._parseTurtle(content, baseUri);
        } else if (format === 'jsonld') {
          return await this._parseJsonLD(content, baseUri);
        } else if (format === 'ntriples') {
          return await this._parseNTriples(content, baseUri);
        }
      } catch (error) {
        continue; // Try next format
      }
    }
    
    throw new Error('Could not auto-detect RDF format');
  }

  /**
   * Convert RDF term to string
   * @private
   */
  _termToString(term) {
    if (typeof term === 'string') return term;
    if (term && typeof term === 'object' && term.value !== undefined) {
      return term.value;
    }
    return String(term);
  }

  /**
   * Get cache key for URI and options
   * @private
   */
  _getCacheKey(uri, options) {
    const optionsStr = JSON.stringify(options);
    return `${uri}:${optionsStr}`;
  }

  /**
   * Clear cache for a specific URI or all cache
   * @param {string} uri - Optional URI to clear specific cache entry
   */
  clearCache(uri = null) {
    if (uri) {
      // Clear specific URI cache entries
      for (const key of rdfCache.keys()) {
        if (key.startsWith(uri + ':')) {
          rdfCache.delete(key);
        }
      }
    } else {
      // Clear all cache
      rdfCache.clear();
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
    
    for (const [key, value] of rdfCache.entries()) {
      if (now - value.timestamp < CACHE_TTL) {
        validEntries++;
      } else {
        expiredEntries++;
      }
    }
    
    return {
      totalEntries: rdfCache.size,
      validEntries,
      expiredEntries,
      cacheSize: this._getCacheSize()
    };
  }

  /**
   * Get approximate cache size in bytes
   * @private
   */
  _getCacheSize() {
    let size = 0;
    for (const [key, value] of rdfCache.entries()) {
      size += key.length + JSON.stringify(value).length;
    }
    return size;
  }

  /**
   * Check if URI is known to have CORS issues
   * @private
   */
  _isCORSProblematic(uri) {
    const problematicDomains = [
      'ea.com',
      'wikidata.org/entity', // Entity pages (not query endpoint)
      'dbpedia.org/resource', // Resource pages (not query endpoint) 
      'schema.org',
      'w3.org',
      'xmlns.com',
      'google.com',
      'facebook.com',
      'twitter.com',
      'microsoft.com',
      'apple.com'
    ];
    
    return problematicDomains.some(domain => uri.includes(domain));
  }

  /**
   * Check if error is CORS or network related
   * @private
   */
  _isCORSOrNetworkError(error) {
    const errorMessage = error.message.toLowerCase();
    return errorMessage.includes('failed to fetch') || 
           errorMessage.includes('cors') || 
           errorMessage.includes('access-control-allow-origin') ||
           errorMessage.includes('net::err_failed') ||
           errorMessage.includes('network error') ||
           error.name === 'TypeError';
  }

  /**
   * Create fallback data for CORS-blocked URIs
   * @private
   */
  _createFallbackData(uri) {
    const label = this._extractLabelFromURI(uri);
    return {
      uri,
      contentType: 'application/ld+json',
      triples: [],
      metadata: {
        label: label,
        description: `External resource (CORS-protected): ${label}`,
        url: uri,
        corsBlocked: true
      },
      resolvedAt: new Date().toISOString()
    };
  }

  /**
   * Extract readable label from URI
   * @private
   */
  _extractLabelFromURI(uri) {
    try {
      const url = new URL(uri);
      const path = url.pathname || url.hash || '';
      const segments = path.split(/[\/#]/).filter(s => s && s !== 'entity' && s !== 'resource');
      const lastSegment = segments[segments.length - 1] || url.hostname;
      return decodeURIComponent(lastSegment).replace(/[_-]/g, ' ');
    } catch (error) {
      return uri.split('/').pop() || uri;
    }
  }
}

// Export singleton instance
export const rdfResolver = new RDFResolver();

// Export utility functions
export const resolveURI = (uri, options) => rdfResolver.resolveURI(uri, options);
export const clearCache = (uri) => rdfResolver.clearCache(uri);
export const getCacheStats = () => rdfResolver.getCacheStats();
