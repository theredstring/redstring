/**
 * Tests for RDF Resolver Service
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RDFResolver, rdfResolver } from '../../src/services/rdfResolver.js';

// Mock fetch for testing
global.fetch = vi.fn();

describe('RDF Resolver', () => {
  let resolver;

  beforeEach(() => {
    resolver = new RDFResolver();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('resolveURI', () => {
    it('should resolve a valid URI successfully', async () => {
      const mockResponse = {
        ok: true,
        headers: new Map([['content-type', 'text/turtle']]),
        text: () => Promise.resolve('@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> . <http://example.com/test> rdf:type <http://example.com/Class> .')
      };

      global.fetch.mockResolvedValue(mockResponse);

      const result = await resolver.resolveURI('http://example.com/test');

      expect(result).toBeDefined();
      expect(result.uri).toBe('http://example.com/test');
      expect(result.contentType).toBe('text/turtle');
      expect(result.triples).toBeInstanceOf(Array);
      expect(result.triples.length).toBeGreaterThan(0);
    });

    it('should handle HTTP errors gracefully', async () => {
      const mockResponse = {
        ok: false,
        status: 404,
        statusText: 'Not Found'
      };

      global.fetch.mockResolvedValue(mockResponse);

      await expect(resolver.resolveURI('http://example.com/notfound'))
        .rejects.toThrow('HTTP 404: Not Found');
    });

    it('should handle network errors gracefully', async () => {
      global.fetch.mockRejectedValue(new Error('Network error'));

      await expect(resolver.resolveURI('http://example.com/test'))
        .rejects.toThrow('Network error');
    });

    it('should use cached results when available', async () => {
      const mockResponse = {
        ok: true,
        headers: new Map([['content-type', 'text/turtle']]),
        text: () => Promise.resolve('@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .')
      };

      global.fetch.mockResolvedValue(mockResponse);

      // First call
      const result1 = await resolver.resolveURI('http://example.com/test');
      
      // Second call should use cache
      const result2 = await resolver.resolveURI('http://example.com/test');

      expect(result1).toEqual(result2);
      expect(global.fetch).toHaveBeenCalledTimes(1); // Only called once due to caching
    });
  });

  describe('cache management', () => {
    it('should clear cache correctly', async () => {
      const mockResponse = {
        ok: true,
        headers: new Map([['content-type', 'text/turtle']]),
        text: () => Promise.resolve('@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .')
      };

      global.fetch.mockResolvedValue(mockResponse);

      await resolver.resolveURI('http://example.com/test');
      
      const statsBefore = resolver.getCacheStats();
      expect(statsBefore.totalEntries).toBeGreaterThan(0);

      resolver.clearCache();
      
      const statsAfter = resolver.getCacheStats();
      expect(statsAfter.totalEntries).toBe(0);
    });

    it('should provide accurate cache statistics', async () => {
      const stats = resolver.getCacheStats();
      
      expect(stats).toHaveProperty('totalEntries');
      expect(stats).toHaveProperty('validEntries');
      expect(stats).toHaveProperty('expiredEntries');
      expect(stats).toHaveProperty('cacheSize');
      
      expect(typeof stats.totalEntries).toBe('number');
      expect(typeof stats.validEntries).toBe('number');
      expect(typeof stats.expiredEntries).toBe('number');
      expect(typeof stats.cacheSize).toBe('number');
    });
  });

  describe('format parsing', () => {
    it('should parse Turtle format correctly', async () => {
      const turtleContent = `
        @prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
        @prefix ex: <http://example.com/> .
        
        ex:Person rdf:type rdf:Class .
        ex:John rdf:type ex:Person .
        ex:John ex:name "John Doe" .
      `;

      const result = await resolver._parseTurtle(turtleContent, 'http://example.com/');
      
      expect(result.triples).toBeInstanceOf(Array);
      expect(result.triples.length).toBe(3);
      expect(result.metadata.format).toBe('turtle');
    });

    it('should parse JSON-LD format correctly', async () => {
      const jsonldContent = {
        "@context": {
          "rdf": "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
          "ex": "http://example.com/"
        },
        "@id": "http://example.com/Person",
        "@type": "rdf:Class",
        "rdfs:label": "Person"
      };

      const result = await resolver._parseJsonLD(JSON.stringify(jsonldContent), 'http://example.com/');
      
      expect(result.triples).toBeInstanceOf(Array);
      expect(result.metadata.format).toBe('jsonld');
    });

    it('should parse N-Triples format correctly', async () => {
      const ntriplesContent = `
        <http://example.com/Person> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://www.w3.org/1999/02/22-rdf-syntax-ns#Class> .
        <http://example.com/John> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://example.com/Person> .
      `;

      const result = await resolver._parseNTriples(ntriplesContent, 'http://example.com/');
      
      expect(result.triples).toBeInstanceOf(Array);
      expect(result.triples.length).toBe(2);
      expect(result.metadata.format).toBe('ntriples');
    });
  });

  describe('content negotiation', () => {
    it('should send proper Accept headers', async () => {
      const mockResponse = {
        ok: true,
        headers: new Map([['content-type', 'text/turtle']]),
        text: () => Promise.resolve('@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .')
      };

      global.fetch.mockResolvedValue(mockResponse);

      await resolver.resolveURI('http://example.com/test');

      expect(global.fetch).toHaveBeenCalledWith(
        'http://example.com/test',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Accept': expect.stringContaining('text/turtle')
          })
        })
      );
    });
  });
});
