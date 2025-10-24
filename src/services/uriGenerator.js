/**
 * URI Generator Service
 * Generates URIs dynamically based on user domains
 * Replaces hardcoded redstring.io URIs with user-controlled namespaces
 */

class URIGeneratorService {
  constructor() {
    this.defaultNamespace = 'https://redstring.io/vocab/';
  }

  /**
   * Generate URIs for a user's domain
   * @param {string} domain - User's domain (e.g., "alice.com")
   * @returns {Object} URI configuration
   */
  generateUserURIs(domain) {
    const normalizedDomain = this.normalizeDomain(domain);
    
    return {
      vocab: `https://${normalizedDomain}/redstring/vocab/`,
      spaces: `https://${normalizedDomain}/redstring/spaces/`,
      webId: `https://${normalizedDomain}/profile/card#me`,
      pod: `https://${normalizedDomain}/`,
      discovery: `https://${normalizedDomain}/.well-known/redstring-discovery`,
      verification: `https://${normalizedDomain}/.well-known/redstring-verification`
    };
  }

  /**
   * Generate a vocabulary URI for a concept
   * @param {string} domain - User's domain
   * @param {string} concept - Concept name (e.g., "ClimatePolicy")
   * @returns {string} Full URI
   */
  generateVocabURI(domain, concept) {
    const uris = this.generateUserURIs(domain);
    const normalizedConcept = this.normalizeConcept(concept);
    return `${uris.vocab}${normalizedConcept}`;
  }

  /**
   * Generate a space URI
   * @param {string} domain - User's domain
   * @param {string} spaceName - Space name
   * @returns {string} Full URI
   */
  generateSpaceURI(domain, spaceName) {
    const uris = this.generateUserURIs(domain);
    const normalizedSpace = this.normalizeSpace(spaceName);
    return `${uris.spaces}${normalizedSpace}`;
  }

  /**
   * Generate a node URI
   * @param {string} domain - User's domain
   * @param {string} nodeId - Node ID
   * @returns {string} Full URI
   */
  generateNodeURI(domain, nodeId) {
    const uris = this.generateUserURIs(domain);
    return `${uris.vocab}node:${nodeId}`;
  }

  /**
   * Generate an edge URI
   * @param {string} domain - User's domain
   * @param {string} edgeId - Edge ID
   * @returns {string} Full URI
   */
  generateEdgeURI(domain, edgeId) {
    const uris = this.generateUserURIs(domain);
    return `${uris.vocab}edge:${edgeId}`;
  }

  /**
   * Generate a graph URI
   * @param {string} domain - User's domain
   * @param {string} graphId - Graph ID
   * @returns {string} Full URI
   */
  generateGraphURI(domain, graphId) {
    const uris = this.generateUserURIs(domain);
    return `${uris.vocab}graph:${graphId}`;
  }

  /**
   * Extract domain from a URI
   * @param {string} uri - Full URI
   * @returns {string|null} Domain or null
   */
  extractDomainFromURI(uri) {
    try {
      const url = new URL(uri);
      return url.hostname;
    } catch (error) {
      return null;
    }
  }

  /**
   * Extract concept name from a vocabulary URI
   * @param {string} uri - Vocabulary URI
   * @returns {string|null} Concept name or null
   */
  extractConceptFromURI(uri) {
    try {
      const url = new URL(uri);
      const pathParts = url.pathname.split('/');
      const vocabIndex = pathParts.findIndex(part => part === 'vocab');
      if (vocabIndex !== -1 && vocabIndex < pathParts.length - 1) {
        return pathParts[vocabIndex + 1];
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Check if a URI belongs to a specific domain
   * @param {string} uri - URI to check
   * @param {string} domain - Domain to check against
   * @returns {boolean} True if URI belongs to domain
   */
  isURIFromDomain(uri, domain) {
    const uriDomain = this.extractDomainFromURI(uri);
    return uriDomain === this.normalizeDomain(domain);
  }

  /**
   * Normalize domain name
   * @param {string} domain - Raw domain input
   * @returns {string} Normalized domain
   */
  normalizeDomain(domain) {
    // Remove protocol if present
    let normalized = domain.replace(/^https?:\/\//, '');
    // Remove trailing slash
    normalized = normalized.replace(/\/$/, '');
    // Remove www. prefix
    normalized = normalized.replace(/^www\./, '');
    return normalized.toLowerCase();
  }

  /**
   * Normalize concept name for URI
   * @param {string} concept - Raw concept name
   * @returns {string} Normalized concept name
   */
  normalizeConcept(concept) {
    return concept
      .replace(/[^a-zA-Z0-9-_]/g, '')
      .replace(/^[0-9]/, 'c$&') // Prefix with 'c' if starts with number
      .replace(/[A-Z]/g, (match, index) => {
        return index === 0 ? match.toLowerCase() : match;
      });
  }

  /**
   * Normalize space name for URI
   * @param {string} spaceName - Raw space name
   * @returns {string} Normalized space name
   */
  normalizeSpace(spaceName) {
    return spaceName
      .replace(/[^a-zA-Z0-9-_]/g, '_')
      .toLowerCase();
  }

  /**
   * Generate JSON-LD context with user's URIs
   * @param {string} domain - User's domain
   * @returns {Object} JSON-LD context
   */
  generateContext(domain) {
    const uris = this.generateUserURIs(domain);
    
    return {
      "@version": 1.1,
      "@vocab": uris.vocab,
      
      // Core Redstring Concepts
      "redstring": uris.vocab,
      "Graph": "redstring:Graph",
      "Node": "redstring:Node", 
      "Edge": "redstring:Edge",
      "SpatialContext": "redstring:SpatialContext",
      
      // Recursive Composition
      "defines": "redstring:defines",
      "definedBy": "redstring:definedBy", 
      "expandsTo": "redstring:expandsTo",
      "contractsFrom": "redstring:contractsFrom",
      "contextualDefinition": "redstring:contextualDefinition",
      
      // Standard Vocabularies
      "name": "http://schema.org/name",
      "description": "http://schema.org/description",
      "color": "http://schema.org/color",
      "image": "http://schema.org/image",
      "thumbnail": "http://schema.org/thumbnail",
      "contains": "http://purl.org/dc/terms/hasPart",
      "partOf": "http://purl.org/dc/terms/isPartOf",
      "composedOf": "http://purl.org/vocab/frbr/core#embodiment",
      "composes": "http://purl.org/vocab/frbr/core#embodimentOf",
      
      // RDFS for class hierarchies
      "rdfs": "http://www.w3.org/2000/01/rdf-schema#",
      "subClassOf": "rdfs:subClassOf",

      // RDF for statements
      "rdf": "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
      "Statement": "rdf:Statement",
      "subject": { "@id": "rdf:subject", "@type": "@id" },
      "predicate": { "@id": "rdf:predicate", "@type": "@id" },
      "object": { "@id": "rdf:object", "@type": "@id" },
      
      // Spatial & UI State
      "x": "redstring:xCoordinate",
      "y": "redstring:yCoordinate", 
      "scale": "redstring:scale",
      "viewport": "redstring:viewport",
      "expanded": "redstring:expanded",
      "visible": "redstring:visible",
      
      // Cognitive Concepts
      "saved": "redstring:bookmarked",
      "active": "redstring:activeInContext",
      "definitionIndex": "redstring:currentDefinitionIndex",
      "contextKey": "redstring:contextKey",
      
      // Temporal & Versioning
      "created": "http://purl.org/dc/terms/created",
      "modified": "http://purl.org/dc/terms/modified",
      "version": "http://purl.org/dc/terms/hasVersion",
      
      // Solid Pod Federation
      "pod": "https://www.w3.org/ns/solid/terms#pod",
      "webId": "http://xmlns.com/foaf/0.1/webId",
      "references": "redstring:references",
      "linkedThinking": "redstring:linkedThinking"
    };
  }

  /**
   * Generate cross-domain reference URI
   * @param {string} sourceDomain - Source domain
   * @param {string} targetDomain - Target domain
   * @param {string} concept - Concept being referenced
   * @returns {string} Cross-domain reference URI
   */
  generateCrossDomainReference(sourceDomain, targetDomain, concept) {
    const sourceURIs = this.generateUserURIs(sourceDomain);
    const targetConceptURI = this.generateVocabURI(targetDomain, concept);
    
    return `${sourceURIs.vocab}references:${this.normalizeDomain(targetDomain)}:${this.normalizeConcept(concept)}`;
  }

  /**
   * Parse cross-domain reference URI
   * @param {string} referenceURI - Cross-domain reference URI
   * @returns {Object|null} Parsed reference or null
   */
  parseCrossDomainReference(referenceURI) {
    try {
      const url = new URL(referenceURI);
      const pathParts = url.pathname.split('/');
      const referencesIndex = pathParts.findIndex(part => part === 'references');
      
      if (referencesIndex !== -1 && referencesIndex < pathParts.length - 2) {
        const targetDomain = pathParts[referencesIndex + 1];
        const concept = pathParts[referencesIndex + 2];
        const sourceDomain = url.hostname;
        
        return {
          sourceDomain,
          targetDomain,
          concept,
          targetURI: this.generateVocabURI(targetDomain, concept)
        };
      }
      
      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Generate federation metadata URI
   * @param {string} domain - User's domain
   * @returns {string} Federation metadata URI
   */
  generateFederationMetadataURI(domain) {
    const uris = this.generateUserURIs(domain);
    return `${uris.vocab}federation:metadata`;
  }

  /**
   * Generate user profile URI
   * @param {string} domain - User's domain
   * @returns {string} User profile URI
   */
  generateUserProfileURI(domain) {
    const uris = this.generateUserURIs(domain);
    return `${uris.vocab}profile:user`;
  }
}

// Create and export singleton instance
export const uriGenerator = new URIGeneratorService();
export default uriGenerator; 