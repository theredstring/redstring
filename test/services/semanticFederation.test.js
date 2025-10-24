import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock fetch globally
global.fetch = vi.fn();

// Mock window.location
Object.defineProperty(window, 'location', {
  value: {
    hostname: 'localhost'
  },
  writable: true
});

import { SemanticFederation } from '../../src/services/semanticFederation.js';

describe('SemanticFederation', () => {
  let mockSyncEngine;
  let federation;
  let setIntervalSpy;
  let clearIntervalSpy;

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Mock timers
    vi.useFakeTimers();
    
    // Spy on setInterval and clearInterval
    setIntervalSpy = vi.spyOn(global, 'setInterval');
    clearIntervalSpy = vi.spyOn(global, 'clearInterval');
    
    // Create mock sync engine
    mockSyncEngine = {
      getConcept: vi.fn(),
      updateConcept: vi.fn()
    };

    federation = new SemanticFederation(mockSyncEngine);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Initialization', () => {
    it('should initialize with sync engine', () => {
      expect(federation.syncEngine).toBe(mockSyncEngine);
      expect(federation.subscriptions).toBeInstanceOf(Map);
      expect(federation.externalConcepts).toBeInstanceOf(Map);
      expect(federation.discoveryCache).toBeInstanceOf(Map);
      expect(federation.pollingInterval).toBe(30000);
      expect(federation.cacheExpiry).toBe(300000);
    });

    it('should start polling on initialization', () => {
      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 30000);
    });
  });

  describe('Space Subscription', () => {
    it('should subscribe to a semantic space successfully', async () => {
      const spaceUrl = 'https://alice.github.io/semantic/';
      
      // Mock discovery response
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          name: 'Alice Research',
          description: 'Climate policy research',
          concepts: [
            { id: 'climate-policy', name: 'Climate Policy', url: 'https://alice.github.io/semantic/vocabulary/concepts/climate-policy.ttl' }
          ]
        })
      });

      const subscription = await federation.subscribeToSpace(spaceUrl, {
        autoImport: true
      });

      expect(subscription.url).toBe(spaceUrl);
      expect(subscription.name).toBe('Alice Research');
      expect(subscription.description).toBe('Climate policy research');
      expect(subscription.concepts.has('climate-policy')).toBe(true);
      expect(subscription.active).toBe(true);
      expect(subscription.autoImport).toBe(true);
      expect(federation.subscriptions.has(spaceUrl)).toBe(true);
    });

    it('should handle subscription failures gracefully', async () => {
      const spaceUrl = 'https://invalid-url.com/semantic/';
      
      // Mock discovery to fail
      global.fetch.mockRejectedValueOnce(new Error('Network error'));

      // The method should handle the error and return a subscription with 0 concepts
      const subscription = await federation.subscribeToSpace(spaceUrl);
      
      expect(subscription.url).toBe(spaceUrl);
      expect(subscription.concepts.size).toBe(0);
      expect(subscription.active).toBe(true);
    });

    it('should unsubscribe from a space', () => {
      const spaceUrl = 'https://alice.github.io/semantic/';
      
      // Add a subscription first
      federation.subscriptions.set(spaceUrl, {
        url: spaceUrl,
        name: 'Alice Research',
        active: true,
        concepts: new Set(['concept1'])
      });

      federation.unsubscribeFromSpace(spaceUrl);

      expect(federation.subscriptions.has(spaceUrl)).toBe(false);
    });

    it('should extract name from URL', () => {
      expect(federation.extractNameFromUrl('https://alice.github.io/semantic/')).toBe('alice.github.io');
      expect(federation.extractNameFromUrl('https://www.example.com/knowledge/')).toBe('example.com');
      expect(federation.extractNameFromUrl('invalid-url')).toBe('invalid-url');
    });
  });

  describe('Space Discovery', () => {
    it('should discover space with well-known discovery file', async () => {
      const spaceUrl = 'https://alice.github.io/semantic/';
      
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          name: 'Alice Research',
          description: 'Climate policy research',
          concepts: [
            { id: 'climate-policy', name: 'Climate Policy' }
          ],
          lastUpdated: '2023-01-01T00:00:00.000Z'
        })
      });

      const discovery = await federation.discoverSpace(spaceUrl);

      expect(discovery.name).toBe('Alice Research');
      expect(discovery.description).toBe('Climate policy research');
      expect(discovery.concepts).toHaveLength(1);
      expect(discovery.lastUpdated).toBe('2023-01-01T00:00:00.000Z');
      expect(discovery.discoveredAt).toBeDefined();

      // Check that fetch was called with the discovery URL (fixing double slash issue)
      const fetchCall = fetch.mock.calls[0];
      expect(fetchCall[0]).toMatch(/https:\/\/alice\.github\.io\/semantic\/\.well-known\/redstring-discovery/);
      expect(fetchCall[1]).toEqual(expect.objectContaining({
        headers: { 'Accept': 'application/json' }
      }));
    });

    it('should fallback to directory discovery when well-known file not found', async () => {
      const spaceUrl = 'https://alice.github.io/semantic/';
      
      // Mock well-known file not found
      global.fetch.mockResolvedValueOnce({
        ok: false
      });

      // Mock directory listing
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([
          { path: 'vocabulary/concepts/climate-policy.ttl', name: 'climate-policy.ttl' }
        ])
      });

      const discovery = await federation.discoverFromDirectory(spaceUrl);

      expect(discovery.name).toBe('alice.github.io');
      expect(discovery.description).toBe('Auto-discovered space');
      expect(discovery.concepts).toHaveLength(1);
      // The implementation should extract the concept ID from the filename
      expect(discovery.concepts[0].id).toBe('climate-policy');
    });

    it('should handle discovery failures gracefully', async () => {
      const spaceUrl = 'https://invalid-url.com/semantic/';
      
      global.fetch.mockRejectedValueOnce(new Error('Network error'));

      const discovery = await federation.discoverSpace(spaceUrl);

      expect(discovery.name).toBe('invalid-url.com');
      expect(discovery.description).toBe('Auto-discovered space');
      expect(discovery.concepts).toEqual([]);
    });

    it('should cache discovery results', async () => {
      const spaceUrl = 'https://alice.github.io/semantic/';
      
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          name: 'Alice Research',
          description: 'Climate policy research',
          concepts: []
        })
      });

      // First discovery
      const discovery1 = await federation.discoverSpace(spaceUrl);
      
      // Second discovery (should use cache)
      const discovery2 = await federation.discoverSpace(spaceUrl);

      expect(discovery1).toEqual(discovery2);
      expect(fetch).toHaveBeenCalledTimes(1); // Only called once due to caching
    });
  });

  describe('External Concept Caching', () => {
    it('should cache external concept successfully', async () => {
      const conceptUrl = 'https://alice.github.io/semantic/vocabulary/concepts/climate-policy.ttl';
      const sourceUrl = 'https://alice.github.io/semantic/';
      
      const ttlContent = `
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
redstring:climate-policy a redstring:Concept ;
    rdfs:label "Climate Policy" ;
    rdfs:comment "Environmental policy framework" .
`;

      global.fetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(ttlContent)
      });

      const cachedConcept = await federation.cacheExternalConcept(conceptUrl, sourceUrl);

      expect(cachedConcept.url).toBe(conceptUrl);
      expect(cachedConcept.sourceUrl).toBe(sourceUrl);
      expect(cachedConcept.data.name).toBe('Climate Policy');
      expect(cachedConcept.data.description).toBe('Environmental policy framework');
      expect(cachedConcept.cachedAt).toBeDefined();
      expect(cachedConcept.lastAccessed).toBeDefined();

      expect(federation.externalConcepts.has(conceptUrl)).toBe(true);
    });

    it('should get cached external concept', async () => {
      const conceptUrl = 'https://alice.github.io/semantic/vocabulary/concepts/climate-policy.ttl';
      
      const cachedConcept = {
        url: conceptUrl,
        sourceUrl: 'https://alice.github.io/semantic/',
        data: { name: 'Climate Policy', description: 'Environmental policy framework' },
        cachedAt: new Date().toISOString(),
        lastAccessed: new Date().toISOString()
      };

      federation.externalConcepts.set(conceptUrl, cachedConcept);

      const result = await federation.getExternalConcept(conceptUrl);

      expect(result).toEqual(cachedConcept);
    });

    it('should refresh expired cache', async () => {
      const conceptUrl = 'https://alice.github.io/semantic/vocabulary/concepts/climate-policy.ttl';
      
      const expiredConcept = {
        url: conceptUrl,
        sourceUrl: 'https://alice.github.io/semantic/',
        data: { name: 'Old Climate Policy' },
        cachedAt: new Date(Date.now() - 400000).toISOString(), // Expired
        lastAccessed: new Date().toISOString()
      };

      federation.externalConcepts.set(conceptUrl, expiredConcept);

      const newTtlContent = `
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
redstring:climate-policy a redstring:Concept ;
    rdfs:label "Updated Climate Policy" ;
    rdfs:comment "Updated environmental policy framework" .
`;

      global.fetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(newTtlContent)
      });

      const result = await federation.getExternalConcept(conceptUrl);

      expect(result.data.name).toBe('Updated Climate Policy');
      expect(fetch).toHaveBeenCalledWith(conceptUrl);
    });

    it('should handle concept fetch failures gracefully', async () => {
      const conceptUrl = 'https://alice.github.io/semantic/vocabulary/concepts/climate-policy.ttl';
      
      global.fetch.mockRejectedValueOnce(new Error('Fetch failed'));

      const result = await federation.getExternalConcept(conceptUrl);

      expect(result).toBeNull();
    });
  });

  describe('Cross-Reference Creation', () => {
    it('should create cross-reference between local and external concepts', async () => {
      const localConceptId = 'local-concept';
      const externalConceptUrl = 'https://alice.github.io/semantic/vocabulary/concepts/climate-policy.ttl';
      
      const localConcept = {
        name: 'Local Concept',
        relationships: {}
      };

      const externalConcept = {
        url: externalConceptUrl,
        sourceUrl: 'https://alice.github.io/semantic/',
        data: { name: 'Climate Policy' },
        cachedAt: new Date().toISOString()
      };

      mockSyncEngine.getConcept.mockReturnValue(localConcept);
      federation.externalConcepts.set(externalConceptUrl, externalConcept);

      await federation.createCrossReference(localConceptId, externalConceptUrl, 'influences');

      expect(mockSyncEngine.updateConcept).toHaveBeenCalledWith(
        localConceptId,
        expect.objectContaining({
          relationships: {
            influences: [externalConceptUrl]
          }
        })
      );
    });

    it('should handle cross-reference creation failures', async () => {
      const localConceptId = 'local-concept';
      const externalConceptUrl = 'https://alice.github.io/semantic/vocabulary/concepts/climate-policy.ttl';
      
      mockSyncEngine.getConcept.mockReturnValue(null);

      await expect(federation.createCrossReference(localConceptId, externalConceptUrl))
        .rejects.toThrow('External concept not found');
    });
  });

  describe('Related Concept Discovery', () => {
    it('should find related concepts across federation', async () => {
      const conceptId = 'local-concept';
      
      const localConcept = {
        name: 'Local Concept',
        relationships: {
          influences: ['https://alice.github.io/semantic/vocabulary/concepts/climate-policy.ttl'],
          references: ['https://bob.gitlab.com/knowledge/concepts/economic-growth.ttl']
        }
      };

      const externalConcept1 = {
        url: 'https://alice.github.io/semantic/vocabulary/concepts/climate-policy.ttl',
        sourceUrl: 'https://alice.github.io/semantic/',
        data: { name: 'Climate Policy' }
      };

      const externalConcept2 = {
        url: 'https://bob.gitlab.com/knowledge/concepts/economic-growth.ttl',
        sourceUrl: 'https://bob.gitlab.com',
        data: { name: 'Economic Growth' }
      };

      mockSyncEngine.getConcept.mockReturnValue(localConcept);
      federation.externalConcepts.set(externalConcept1.url, externalConcept1);
      federation.externalConcepts.set(externalConcept2.url, externalConcept2);

      const relatedConcepts = await federation.findRelatedConcepts(conceptId);

      expect(relatedConcepts).toHaveLength(2);
      expect(relatedConcepts[0]).toEqual({
        url: externalConcept1.url,
        sourceUrl: externalConcept1.sourceUrl,
        data: externalConcept1.data,
        relationshipType: 'influences'
      });
      expect(relatedConcepts[1]).toEqual({
        url: externalConcept2.url,
        sourceUrl: externalConcept2.sourceUrl,
        data: externalConcept2.data,
        relationshipType: 'references'
      });
    });

    it('should find incoming references', async () => {
      const conceptId = 'local-concept';
      
      const localConcept = {
        name: 'Local Concept',
        relationships: {}
      };

      const externalConcept = {
        url: 'https://alice.github.io/semantic/vocabulary/concepts/climate-policy.ttl',
        sourceUrl: 'https://alice.github.io/semantic/',
        data: {
          name: 'Climate Policy',
          relationships: {
            references: [conceptId]
          }
        }
      };

      mockSyncEngine.getConcept.mockReturnValue(localConcept);
      federation.externalConcepts.set(externalConcept.url, externalConcept);

      const relatedConcepts = await federation.findRelatedConcepts(conceptId);

      expect(relatedConcepts).toHaveLength(1);
      expect(relatedConcepts[0]).toEqual({
        url: externalConcept.url,
        sourceUrl: externalConcept.sourceUrl,
        data: externalConcept.data,
        relationshipType: 'references',
        direction: 'incoming'
      });
    });
  });

  describe('Subscription Polling', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it('should poll subscriptions for updates', async () => {
      const spaceUrl = 'https://alice.github.io/semantic/';
      
      const subscription = {
        url: spaceUrl,
        name: 'Alice Research',
        active: true,
        concepts: new Set(['existing-concept']),
        lastChecked: new Date().toISOString(),
        autoImport: true // Enable auto-import so concepts get cached
      };

      federation.subscriptions.set(spaceUrl, subscription);

      // Mock discovery response with new concept - return proper Response object
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          name: 'Alice Research',
          concepts: [
            { id: 'existing-concept', name: 'Existing Concept' },
            { id: 'new-concept', name: 'New Concept', url: 'https://alice.github.io/semantic/vocabulary/concepts/new-concept.ttl' }
          ]
        })
      });

      // Mock concept caching - return proper Response object
      global.fetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(`
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
redstring:new-concept a redstring:Concept ;
    rdfs:label "New Concept" .
`)
      });

      // Get the polling function from setInterval and call it directly
      const pollingFunction = setIntervalSpy.mock.calls[0][0];
      await pollingFunction();

      expect(subscription.concepts.has('new-concept')).toBe(true);
      expect(subscription.lastUpdate).toBeDefined();
      expect(federation.externalConcepts.has('https://alice.github.io/semantic/vocabulary/concepts/new-concept.ttl')).toBe(true);
    });

    it('should skip inactive subscriptions during polling', async () => {
      const spaceUrl = 'https://alice.github.io/semantic/';
      
      const subscription = {
        url: spaceUrl,
        name: 'Alice Research',
        active: false,
        concepts: new Set()
      };

      federation.subscriptions.set(spaceUrl, subscription);

      // Get the polling function from setInterval and call it directly
      const pollingFunction = setIntervalSpy.mock.calls[0][0];
      await pollingFunction();

      expect(fetch).not.toHaveBeenCalled();
    });
  });

  describe('Federation Statistics', () => {
    it('should get federation statistics', () => {
      // Add some subscriptions
      federation.subscriptions.set('https://alice.github.io/semantic/', {
        url: 'https://alice.github.io/semantic/',
        active: true,
        concepts: new Set(['concept1', 'concept2'])
      });

      federation.subscriptions.set('https://bob.gitlab.com/knowledge/', {
        url: 'https://bob.gitlab.com/knowledge/',
        active: false,
        concepts: new Set(['concept3'])
      });

      // Add some cached concepts
      federation.externalConcepts.set('concept1', { data: {} });
      federation.externalConcepts.set('concept2', { data: {} });

      const stats = federation.getFederationStats();

      expect(stats.activeSubscriptions).toBe(1);
      expect(stats.totalSubscribedConcepts).toBe(2);
      expect(stats.cachedExternalConcepts).toBe(2);
      expect(stats.lastPoll).toBeDefined();
    });
  });

  describe('TTL Parsing', () => {
    it('should parse TTL concept content', () => {
      const ttlContent = `
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix schema: <http://schema.org/> .
@prefix redstring: <https://redstring.io/vocab/> .

redstring:climate-policy a redstring:Concept ;
    rdfs:label "Climate Policy" ;
    rdfs:comment "Environmental policy framework" ;
    schema:color "#00ff00" ;
    redstring:influences redstring:economic-growth ;
    redstring:references redstring:carbon-tax .
`;

      const concept = federation.parseTTLConcept(ttlContent);

      expect(concept.name).toBe('Climate Policy');
      expect(concept.description).toBe('Environmental policy framework');
      expect(concept.color).toBe('#00ff00');
      expect(concept.relationships.influences).toContain('economic-growth');
      expect(concept.relationships.references).toContain('carbon-tax');
    });

    it('should handle empty TTL content', () => {
      const concept = federation.parseTTLConcept('');

      expect(concept.name).toBe('');
      expect(concept.description).toBe('');
      expect(concept.color).toBe('');
      expect(concept.relationships).toEqual({});
    });
  });

  describe('URL Utilities', () => {
    it('should check if URL is external', () => {
      expect(federation.isExternalUrl('https://alice.github.io/semantic/')).toBe(true);
      expect(federation.isExternalUrl('https://localhost/semantic/')).toBe(false);
      expect(federation.isExternalUrl('invalid-url')).toBe(false);
    });

    it('should extract source URL from concept URL', () => {
      expect(federation.extractSourceUrl('https://alice.github.io/semantic/vocabulary/concepts/climate-policy.ttl'))
        .toBe('https://alice.github.io');
      expect(federation.extractSourceUrl('invalid-url')).toBe('invalid-url');
    });

    it('should check if cache is expired', () => {
      const recentTime = new Date().toISOString();
      const oldTime = new Date(Date.now() - 400000).toISOString(); // 6+ minutes ago

      expect(federation.isCacheExpired(recentTime)).toBe(false);
      expect(federation.isCacheExpired(oldTime)).toBe(true);
    });
  });
}); 