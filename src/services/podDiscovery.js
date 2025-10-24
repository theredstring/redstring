/**
 * Pod Discovery Service
 * Handles dynamic discovery of Redstring Pods across domains
 * No hardcoded values - discovers Pods through RDF links and well-known files
 */

import domainVerification from './domainVerification.js';

class PodDiscoveryService {
  constructor() {
    this.discoveryCache = new Map();
    this.cacheExpiry = 30 * 60 * 1000; // 30 minutes
  }

  /**
   * Discover Redstring Pods in the network
   * @param {Array<string>} knownDomains - Array of domains to start discovery from
   * @returns {Promise<Array>} Array of discovered Pod configurations
   */
  async discoverPods(knownDomains = []) {
    try {
      const discoveredPods = new Set();
      const domainsToCheck = new Set(knownDomains);
      const checkedDomains = new Set();

      // Start with known domains
      for (const domain of knownDomains) {
        const pods = await this.discoverPodsFromDomain(domain);
        pods.forEach(pod => discoveredPods.add(JSON.stringify(pod)));
        checkedDomains.add(domain);
      }

      // Discover additional domains through well-known files
      const additionalDomains = await this.discoverDomainsFromWellKnown();
      for (const domain of additionalDomains) {
        if (!checkedDomains.has(domain)) {
          const pods = await this.discoverPodsFromDomain(domain);
          pods.forEach(pod => discoveredPods.add(JSON.stringify(pod)));
          checkedDomains.add(domain);
        }
      }

      // Convert back to objects
      return Array.from(discoveredPods).map(podStr => JSON.parse(podStr));
    } catch (error) {
      console.error('[PodDiscovery] Discovery failed:', error);
      return [];
    }
  }

  /**
   * Discover Pods from a specific domain
   * @param {string} domain - Domain to check for Pods
   * @returns {Promise<Array>} Array of Pod configurations
   */
  async discoverPodsFromDomain(domain) {
    const cacheKey = `domain:${domain}`;
    const cached = this.getCachedResult(cacheKey);
    if (cached) return cached;

    try {
      const normalizedDomain = domainVerification.normalizeDomain(domain);
      const pods = [];

      // Check for well-known redstring discovery file
      const discoveryUrl = `https://${normalizedDomain}/.well-known/redstring-discovery`;
      try {
        const response = await fetch(discoveryUrl, {
          method: 'GET',
          headers: {
            'Accept': 'application/json'
          }
        });

        if (response.ok) {
          const discoveryData = await response.json();
          if (discoveryData.pods) {
            pods.push(...discoveryData.pods);
          }
        }
      } catch (error) {
        console.log(`[PodDiscovery] No discovery file at ${discoveryUrl}`);
      }

      // Check for Pod at the domain root
      const rootPod = await this.checkForPodAtDomain(normalizedDomain);
      if (rootPod) {
        pods.push(rootPod);
      }

      // Cache the result
      this.cacheResult(cacheKey, pods);
      return pods;
    } catch (error) {
      console.error(`[PodDiscovery] Failed to discover Pods from ${domain}:`, error);
      return [];
    }
  }

  /**
   * Check if a domain hosts a Redstring Pod
   * @param {string} domain - Domain to check
   * @returns {Promise<Object|null>} Pod configuration or null
   */
  async checkForPodAtDomain(domain) {
    try {
      // Check for profile card (WebID)
      const profileUrl = `https://${domain}/profile/card`;
      const response = await fetch(profileUrl, {
        method: 'HEAD'
      });

      if (response.ok) {
        return {
          domain: domain,
          webId: `https://${domain}/profile/card#me`,
          podUrl: `https://${domain}/`,
          discoveryMethod: 'profile-card',
          verified: await domainVerification.verifyDomainOwnership(domain)
        };
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Discover domains through well-known discovery files
   * @returns {Promise<Array<string>>} Array of discovered domains
   */
  async discoverDomainsFromWellKnown() {
    const domains = new Set();

    try {
      // Check common well-known locations for domain lists
      const wellKnownUrls = [
        'https://redstring.io/.well-known/redstring-domains',
        'https://redstring.net/.well-known/redstring-domains'
      ];

      for (const url of wellKnownUrls) {
        try {
          const response = await fetch(url, {
            method: 'GET',
            headers: {
              'Accept': 'application/json'
            }
          });

          if (response.ok) {
            const data = await response.json();
            if (data.domains && Array.isArray(data.domains)) {
              data.domains.forEach(domain => domains.add(domain));
            }
          }
        } catch (error) {
          console.log(`[PodDiscovery] No domain list at ${url}`);
        }
      }
    } catch (error) {
      console.error('[PodDiscovery] Failed to discover domains from well-known:', error);
    }

    return Array.from(domains);
  }

  /**
   * Generate Pod configuration for a user's domain
   * @param {string} domain - User's domain
   * @returns {Object} Pod configuration
   */
  generatePodConfig(domain) {
    const normalizedDomain = domainVerification.normalizeDomain(domain);
    
    return {
      domain: normalizedDomain,
      webId: `https://${normalizedDomain}/profile/card#me`,
      podUrl: `https://${normalizedDomain}/`,
      vocabNamespace: `https://${normalizedDomain}/redstring/vocab/`,
      spacesNamespace: `https://${normalizedDomain}/redstring/spaces/`,
      discoveryUrl: `https://${normalizedDomain}/.well-known/redstring-discovery`,
      custom: true
    };
  }

  /**
   * Generate Node Solid Server configuration
   * @param {Object} podConfig - Pod configuration
   * @returns {Object} NSS configuration
   */
  generateNSSConfig(podConfig) {
    return {
      serverUri: podConfig.podUrl,
      webid: podConfig.webId,
      email: false,
      auth: {
        type: 'oidc',
        issuer: podConfig.podUrl,
        requireEmail: false
      },
      storage: {
        type: 'file',
        path: './data'
      },
      cors: {
        origin: ['https://redstring.io', 'https://redstring.net'],
        credentials: true
      }
    };
  }

  /**
   * Generate discovery file content for a domain
   * @param {Object} podConfig - Pod configuration
   * @returns {Object} Discovery file content
   */
  generateDiscoveryFile(podConfig) {
    return {
      version: '1.0',
      domain: podConfig.domain,
      pods: [podConfig],
      lastUpdated: new Date().toISOString(),
      description: 'Redstring Pod discovery information'
    };
  }

  /**
   * Get cached result if not expired
   * @param {string} key - Cache key
   * @returns {any|null} Cached result or null
   */
  getCachedResult(key) {
    const cached = this.discoveryCache.get(key);
    if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
      return cached.data;
    }
    return null;
  }

  /**
   * Cache a result with timestamp
   * @param {string} key - Cache key
   * @param {any} data - Data to cache
   */
  cacheResult(key, data) {
    this.discoveryCache.set(key, {
      data,
      timestamp: Date.now()
    });
  }

  /**
   * Clear discovery cache
   */
  clearCache() {
    this.discoveryCache.clear();
  }

  /**
   * Get cache statistics
   * @returns {Object} Cache statistics
   */
  getCacheStats() {
    const now = Date.now();
    let validEntries = 0;
    let expiredEntries = 0;

    for (const [key, value] of this.discoveryCache.entries()) {
      if (now - value.timestamp < this.cacheExpiry) {
        validEntries++;
      } else {
        expiredEntries++;
      }
    }

    return {
      totalEntries: this.discoveryCache.size,
      validEntries,
      expiredEntries,
      cacheExpiry: this.cacheExpiry
    };
  }
}

// Create and export singleton instance
export const podDiscovery = new PodDiscoveryService();
export default podDiscovery; 