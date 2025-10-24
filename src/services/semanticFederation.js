/**
 * Semantic Federation Engine
 * Handles cross-domain discovery, subscriptions, and real-time federation
 * Enables informal knowledge pools through TTL-based linking
 */

export class SemanticFederation {
  constructor(syncEngine) {
    this.syncEngine = syncEngine;
    this.subscriptions = new Map(); // URL -> SubscriptionInfo
    this.externalConcepts = new Map(); // URI -> CachedConcept
    this.discoveryCache = new Map(); // URL -> DiscoveryInfo
    this.pollingInterval = 30000; // 30 seconds
    this.cacheExpiry = 300000; // 5 minutes
    
    this.startPolling();
  }

  /**
   * Subscribe to an external semantic space
   * @param {string} spaceUrl - URL of the semantic space
   * @param {Object} options - Subscription options
   * @returns {Promise<SubscriptionInfo>} Subscription information
   */
  async subscribeToSpace(spaceUrl, options = {}) {
    try {
      // Discover the space structure
      const discoveryInfo = await this.discoverSpace(spaceUrl);
      
      const subscription = {
        url: spaceUrl,
        name: discoveryInfo.name || this.extractNameFromUrl(spaceUrl),
        description: discoveryInfo.description || '',
        lastChecked: new Date().toISOString(),
        lastUpdate: null,
        concepts: new Set(),
        autoImport: options.autoImport || false,
        active: true
      };

      // Initial discovery of concepts
      await this.discoverConcepts(spaceUrl, subscription);
      
      this.subscriptions.set(spaceUrl, subscription);
      
      console.log(`[SemanticFederation] Subscribed to ${spaceUrl}: ${subscription.concepts.size} concepts found`);
      
      return subscription;
      
    } catch (error) {
      console.error(`[SemanticFederation] Failed to subscribe to ${spaceUrl}:`, error);
      throw error;
    }
  }

  /**
   * Unsubscribe from a semantic space
   * @param {string} spaceUrl - URL of the semantic space
   */
  unsubscribeFromSpace(spaceUrl) {
    const subscription = this.subscriptions.get(spaceUrl);
    if (subscription) {
      subscription.active = false;
      this.subscriptions.delete(spaceUrl);
      console.log(`[SemanticFederation] Unsubscribed from ${spaceUrl}`);
    }
  }

  /**
   * Discover a semantic space structure
   * @param {string} spaceUrl - URL of the semantic space
   * @returns {Promise<DiscoveryInfo>} Discovery information
   */
  async discoverSpace(spaceUrl) {
    const cacheKey = `discovery:${spaceUrl}`;
    const cached = this.getCachedDiscovery(cacheKey);
    if (cached) return cached;

    try {
      // Try to fetch discovery file - fix double slash issue
      const normalizedUrl = spaceUrl.endsWith('/') ? spaceUrl.slice(0, -1) : spaceUrl;
      const discoveryUrl = `${normalizedUrl}/.well-known/redstring-discovery`;
      const response = await fetch(discoveryUrl, {
        headers: { 'Accept': 'application/json' }
      });

      if (response.ok) {
        const discoveryData = await response.json();
        const discoveryInfo = {
          name: discoveryData.name || this.extractNameFromUrl(spaceUrl),
          description: discoveryData.description || '',
          concepts: discoveryData.concepts || [],
          lastUpdated: discoveryData.lastUpdated,
          discoveredAt: new Date().toISOString()
        };
        
        this.cacheDiscovery(cacheKey, discoveryInfo);
        return discoveryInfo;
      }

      // Fallback: try to discover from directory structure
      return await this.discoverFromDirectory(spaceUrl);
      
    } catch (error) {
      console.warn(`[SemanticFederation] Discovery failed for ${spaceUrl}:`, error);
      return {
        name: this.extractNameFromUrl(spaceUrl),
        description: 'Auto-discovered space',
        concepts: [],
        discoveredAt: new Date().toISOString()
      };
    }
  }

  /**
   * Discover concepts from directory structure
   * @param {string} spaceUrl - URL of the semantic space
   * @returns {Promise<DiscoveryInfo>} Discovery information
   */
  async discoverFromDirectory(spaceUrl) {
    const discoveryInfo = {
      name: this.extractNameFromUrl(spaceUrl),
      description: 'Auto-discovered space',
      concepts: [],
      discoveredAt: new Date().toISOString()
    };

    // Try common semantic paths
    const semanticPaths = [
      'semantic/vocabulary/concepts/',
      'knowledge/vocabulary/concepts/',
      'vocabulary/concepts/'
    ];

    for (const path of semanticPaths) {
      try {
        const response = await fetch(`${spaceUrl}/${path}`, {
          headers: { 'Accept': 'application/json' }
        });
        
        if (response.ok) {
          const files = await response.json();
          const conceptFiles = files.filter(f => f.path.endsWith('.ttl'));
          
          discoveryInfo.concepts = conceptFiles.map(f => ({
            id: f.name.replace('.ttl', ''),
            name: f.name,
            url: f.download_url || `${spaceUrl}/${f.path}`
          }));
          
          break;
        }
      } catch (error) {
        // Continue to next path
      }
    }

    return discoveryInfo;
  }

  /**
   * Discover concepts in a subscribed space
   * @param {string} spaceUrl - URL of the semantic space
   * @param {SubscriptionInfo} subscription - Subscription information
   */
  async discoverConcepts(spaceUrl, subscription) {
    try {
      const discoveryInfo = await this.discoverSpace(spaceUrl);
      
      for (const concept of discoveryInfo.concepts) {
        subscription.concepts.add(concept.id);
        
        // Cache the concept if auto-import is enabled
        if (subscription.autoImport) {
          await this.cacheExternalConcept(concept.url, spaceUrl);
        }
      }
      
      subscription.lastChecked = new Date().toISOString();
      
    } catch (error) {
      console.error(`[SemanticFederation] Concept discovery failed for ${spaceUrl}:`, error);
    }
  }

  /**
   * Cache an external concept
   * @param {string} conceptUrl - URL of the concept TTL file
   * @param {string} sourceUrl - Source space URL
   * @returns {Promise<CachedConcept>} Cached concept information
   */
  async cacheExternalConcept(conceptUrl, sourceUrl) {
    try {
      const response = await fetch(conceptUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch concept: ${response.statusText}`);
      }

      const ttlContent = await response.text();
      const conceptData = this.parseTTLConcept(ttlContent);
      
      const cachedConcept = {
        url: conceptUrl,
        sourceUrl: sourceUrl,
        data: conceptData,
        cachedAt: new Date().toISOString(),
        lastAccessed: new Date().toISOString()
      };

      this.externalConcepts.set(conceptUrl, cachedConcept);
      return cachedConcept;
      
    } catch (error) {
      console.error(`[SemanticFederation] Failed to cache concept ${conceptUrl}:`, error);
      throw error;
    }
  }

  /**
   * Get a cached external concept
   * @param {string} conceptUrl - URL of the concept
   * @returns {Promise<CachedConcept|null>} Cached concept or null
   */
  async getExternalConcept(conceptUrl) {
    const cached = this.externalConcepts.get(conceptUrl);
    
    if (cached && !this.isCacheExpired(cached.cachedAt)) {
      cached.lastAccessed = new Date().toISOString();
      return cached;
    }

    // Try to fetch fresh copy
    try {
      return await this.cacheExternalConcept(conceptUrl, this.extractSourceUrl(conceptUrl));
    } catch (error) {
      return cached || null; // Return stale cache if available
    }
  }

  /**
   * Create a cross-reference to an external concept
   * @param {string} localConceptId - Local concept ID
   * @param {string} externalConceptUrl - External concept URL
   * @param {string} relationshipType - Type of relationship
   */
  async createCrossReference(localConceptId, externalConceptUrl, relationshipType = 'references') {
    try {
      // Get the external concept
      const externalConcept = await this.getExternalConcept(externalConceptUrl);
      if (!externalConcept) {
        throw new Error('External concept not found');
      }

      // Get local concept
      const localConcept = this.syncEngine.getConcept(localConceptId);
      if (!localConcept) {
        throw new Error('Local concept not found');
      }

      // Add cross-reference to local concept
      const updatedConcept = {
        ...localConcept,
        relationships: {
          ...localConcept.relationships,
          [relationshipType]: [
            ...(localConcept.relationships[relationshipType] || []),
            externalConceptUrl
          ]
        }
      };

      this.syncEngine.updateConcept(localConceptId, updatedConcept);
      
      console.log(`[SemanticFederation] Created cross-reference: ${localConceptId} ${relationshipType} ${externalConceptUrl}`);
      
    } catch (error) {
      console.error('[SemanticFederation] Failed to create cross-reference:', error);
      throw error;
    }
  }

  /**
   * Find related concepts across the federation
   * @param {string} conceptId - Local concept ID
   * @returns {Promise<Array>} Array of related external concepts
   */
  async findRelatedConcepts(conceptId) {
    const localConcept = this.syncEngine.getConcept(conceptId);
    if (!localConcept) return [];

    const relatedConcepts = [];

    // Check external references in local concept
    if (localConcept.relationships) {
      for (const [relationType, targets] of Object.entries(localConcept.relationships)) {
        for (const target of targets) {
          if (this.isExternalUrl(target)) {
            try {
              const externalConcept = await this.getExternalConcept(target);
              if (externalConcept) {
                relatedConcepts.push({
                  url: target,
                  sourceUrl: externalConcept.sourceUrl,
                  data: externalConcept.data,
                  relationshipType: relationType
                });
              }
            } catch (error) {
              console.warn(`[SemanticFederation] Failed to fetch related concept ${target}:`, error);
            }
          }
        }
      }
    }

    // Search for concepts that reference this one
    for (const [url, cachedConcept] of this.externalConcepts) {
      if (cachedConcept.data.relationships) {
        for (const [relationType, targets] of Object.entries(cachedConcept.data.relationships)) {
          if (targets.includes(conceptId)) {
            relatedConcepts.push({
              url: url,
              sourceUrl: cachedConcept.sourceUrl,
              data: cachedConcept.data,
              relationshipType: relationType,
              direction: 'incoming'
            });
          }
        }
      }
    }

    return relatedConcepts;
  }

  /**
   * Start polling for updates
   */
  startPolling() {
    setInterval(async () => {
      await this.pollSubscriptions();
    }, this.pollingInterval);
  }

  /**
   * Poll all active subscriptions for updates
   */
  async pollSubscriptions() {
    for (const [url, subscription] of this.subscriptions) {
      if (!subscription.active) continue;

      try {
        const discoveryInfo = await this.discoverSpace(url);
        
        // Check for new concepts
        const newConcepts = discoveryInfo.concepts.filter(concept => 
          !subscription.concepts.has(concept.id)
        );

        if (newConcepts.length > 0) {
          console.log(`[SemanticFederation] Found ${newConcepts.length} new concepts in ${url}`);
          
          // Add new concepts to subscription
          for (const concept of newConcepts) {
            subscription.concepts.add(concept.id);
            
            if (subscription.autoImport) {
              await this.cacheExternalConcept(concept.url, url);
            }
          }

          subscription.lastUpdate = new Date().toISOString();
          
          // Notify about updates
          this.notifySubscriptionUpdate(subscription, newConcepts);
        }

        subscription.lastChecked = new Date().toISOString();
        
      } catch (error) {
        console.error(`[SemanticFederation] Polling failed for ${url}:`, error);
      }
    }
  }

  /**
   * Notify about subscription updates
   * @param {SubscriptionInfo} subscription - Subscription information
   * @param {Array} newConcepts - New concepts found
   */
  notifySubscriptionUpdate(subscription, newConcepts) {
    // This would integrate with the UI notification system
    console.log(`[SemanticFederation] ${subscription.name} has ${newConcepts.length} new concepts`);
  }

  /**
   * Get all subscriptions
   * @returns {Array} Array of subscription information
   */
  getSubscriptions() {
    return Array.from(this.subscriptions.values());
  }

  /**
   * Get federation statistics
   * @returns {Object} Federation statistics
   */
  getFederationStats() {
    const activeSubscriptions = Array.from(this.subscriptions.values()).filter(s => s.active);
    const totalConcepts = activeSubscriptions.reduce((sum, s) => sum + s.concepts.size, 0);
    
    return {
      activeSubscriptions: activeSubscriptions.length,
      totalSubscribedConcepts: totalConcepts,
      cachedExternalConcepts: this.externalConcepts.size,
      lastPoll: new Date().toISOString()
    };
  }

  // Helper methods

  /**
   * Extract name from URL
   * @param {string} url - URL to extract name from
   * @returns {string} Extracted name
   */
  extractNameFromUrl(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.replace(/^www\./, '');
    } catch (error) {
      return url;
    }
  }

  /**
   * Extract source URL from concept URL
   * @param {string} conceptUrl - Concept URL
   * @returns {string} Source URL
   */
  extractSourceUrl(conceptUrl) {
    try {
      const urlObj = new URL(conceptUrl);
      return `${urlObj.protocol}//${urlObj.host}`;
    } catch (error) {
      return conceptUrl;
    }
  }

  /**
   * Check if URL is external
   * @param {string} url - URL to check
   * @returns {boolean} True if external
   */
  isExternalUrl(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname !== window.location.hostname;
    } catch (error) {
      return false;
    }
  }

  /**
   * Check if cache is expired
   * @param {string} cachedAt - Cache timestamp
   * @returns {boolean} True if expired
   */
  isCacheExpired(cachedAt) {
    const cacheTime = new Date(cachedAt).getTime();
    return Date.now() - cacheTime > this.cacheExpiry;
  }

  /**
   * Get cached discovery info
   * @param {string} key - Cache key
   * @returns {DiscoveryInfo|null} Cached discovery or null
   */
  getCachedDiscovery(key) {
    const cached = this.discoveryCache.get(key);
    if (cached && !this.isCacheExpired(cached.cachedAt)) {
      return cached.data;
    }
    return null;
  }

  /**
   * Cache discovery info
   * @param {string} key - Cache key
   * @param {DiscoveryInfo} data - Discovery data
   */
  cacheDiscovery(key, data) {
    this.discoveryCache.set(key, {
      data,
      cachedAt: new Date().toISOString()
    });
  }

  /**
   * Parse TTL concept content
   * @param {string} ttlContent - TTL content
   * @returns {Object} Parsed concept data
   */
  parseTTLConcept(ttlContent) {
    const concept = {
      name: '',
      description: '',
      color: '',
      relationships: {}
    };

    const lines = ttlContent.split('\n');
    
    for (const line of lines) {
      const trimmed = line.trim();
      
      if (trimmed.includes('rdfs:label')) {
        const match = trimmed.match(/"([^"]+)"/);
        if (match) concept.name = match[1];
      }
      
      if (trimmed.includes('rdfs:comment')) {
        const match = trimmed.match(/"([^"]+)"/);
        if (match) concept.description = match[1];
      }
      
      if (trimmed.includes('schema:color')) {
        const match = trimmed.match(/"([^"]+)"/);
        if (match) concept.color = match[1];
      }
      
      // Parse relationships - updated regex to capture full relationship names
      const relationMatch = trimmed.match(/redstring:([a-zA-Z0-9_-]+)\s+redstring:([a-zA-Z0-9_-]+)/);
      if (relationMatch) {
        const [, relationType, targetId] = relationMatch;
        if (!concept.relationships[relationType]) {
          concept.relationships[relationType] = [];
        }
        concept.relationships[relationType].push(targetId);
      }
    }

    return concept;
  }
} 